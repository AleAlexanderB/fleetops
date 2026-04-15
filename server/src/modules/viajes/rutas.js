/**
 * rutas.js
 * Gestión de distancias de rutas:
 * 1. Primero busca en rutas conocidas (distancias reales de viajes completados)
 * 2. Si no hay, consulta OSRM (routing público, gratis)
 * 3. Al completar un viaje, actualiza la ruta con la distancia GPS real
 */

import { db } from '../../database/database.js';
import https from 'https';
import http from 'http';

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Rutas] ${msg}`);
}

// ── Cache en memoria de rutas conocidas ──────────────────────────────────────

const _rutasCache = new Map(); // "origenId-destinoId" → { distanciaKm, duracionAvgMin, cantidadViajes }

function rutaKey(origenId, destinoId) {
  return `${origenId}-${destinoId}`;
}

// ── Init: cargar rutas conocidas de la DB ────────────────────────────────────

export async function initRutas() {
  const pool = db();
  if (!pool) return;

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM fleetops_rutas_conocidas'
    );
    for (const row of rows) {
      _rutasCache.set(rutaKey(row.id_geocerca_origen, row.id_geocerca_destino), {
        distanciaKm:    parseFloat(row.distancia_km),
        duracionAvgMin: row.duracion_avg_min,
        cantidadViajes: row.cantidad_viajes,
        nombreOrigen:   row.nombre_origen,
        nombreDestino:  row.nombre_destino,
      });
    }
    log('info', `${_rutasCache.size} rutas conocidas cargadas`);
  } catch (err) {
    log('error', `Error al cargar rutas: ${err.message}`);
  }
}

// ── Obtener distancia de una ruta ────────────────────────────────────────────

/**
 * Obtiene la distancia de una ruta, intentando en orden:
 * 1. Ruta conocida (histórica, de viajes completados)
 * 2. OSRM (routing público)
 * 3. null si nada funciona
 *
 * @returns {{ distanciaKm: number, duracionMin: number|null, fuente: 'historica'|'osrm'|null }}
 */
export async function obtenerDistanciaRuta(origenId, destinoId, origenCoords, destinoCoords) {
  // 1. Buscar en rutas conocidas
  const key = rutaKey(origenId, destinoId);
  const conocida = _rutasCache.get(key);
  if (conocida && conocida.distanciaKm > 0) {
    log('info', `Ruta conocida: ${conocida.nombreOrigen} → ${conocida.nombreDestino} = ${conocida.distanciaKm} km (${conocida.cantidadViajes} viajes)`);
    return {
      distanciaKm: conocida.distanciaKm,
      duracionMin: conocida.duracionAvgMin,
      fuente: 'historica',
    };
  }

  // 2. Consultar OSRM
  if (origenCoords && destinoCoords) {
    try {
      const osrm = await consultarOSRM(origenCoords, destinoCoords);
      if (osrm) {
        log('info', `OSRM: ${osrm.distanciaKm.toFixed(1)} km, ${osrm.duracionMin} min`);
        return {
          distanciaKm: osrm.distanciaKm,
          duracionMin: osrm.duracionMin,
          fuente: 'osrm',
        };
      }
    } catch (err) {
      log('warn', `Error OSRM: ${err.message}`);
    }
  }

  return { distanciaKm: null, duracionMin: null, fuente: null };
}

// ── OSRM ─────────────────────────────────────────────────────────────────────

function consultarOSRM(origenCoords, destinoCoords) {
  return new Promise((resolve, reject) => {
    const { lat: lat1, lng: lng1 } = origenCoords;
    const { lat: lat2, lng: lng2 } = destinoCoords;

    // OSRM usa lng,lat (inverso)
    const url = `http://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;

    const req = http.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 'Ok' && json.routes && json.routes.length > 0) {
            const route = json.routes[0];
            resolve({
              distanciaKm: route.distance / 1000,
              duracionMin: Math.round(route.duration / 60),
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OSRM timeout')); });
  });
}

// ── Actualizar ruta con datos reales ─────────────────────────────────────────

/**
 * Después de completar un viaje, actualiza la ruta con la distancia GPS real.
 * Usa promedio ponderado para mejorar la precisión con cada viaje.
 */
export async function actualizarRutaReal(origenId, nombreOrigen, destinoId, nombreDestino, distanciaKm, duracionMin) {
  if (!distanciaKm || distanciaKm <= 0) return;

  const key = rutaKey(origenId, destinoId);
  const existente = _rutasCache.get(key);

  let nuevaDistancia, nuevaDuracion, cantidad;

  if (existente && existente.cantidadViajes > 0) {
    // Promedio ponderado: le damos más peso a viajes recientes
    cantidad = existente.cantidadViajes + 1;
    nuevaDistancia = ((existente.distanciaKm * existente.cantidadViajes) + distanciaKm) / cantidad;
    nuevaDuracion = duracionMin
      ? Math.round(((existente.duracionAvgMin || duracionMin) * existente.cantidadViajes + duracionMin) / cantidad)
      : existente.duracionAvgMin;
  } else {
    cantidad = 1;
    nuevaDistancia = distanciaKm;
    nuevaDuracion = duracionMin || null;
  }

  // Actualizar cache
  _rutasCache.set(key, {
    distanciaKm:    Math.round(nuevaDistancia * 100) / 100,
    duracionAvgMin: nuevaDuracion,
    cantidadViajes: cantidad,
    nombreOrigen,
    nombreDestino,
  });

  // Persistir en DB
  const pool = db();
  if (!pool) return;

  try {
    await pool.execute(
      `INSERT INTO fleetops_rutas_conocidas
         (id_geocerca_origen, nombre_origen, id_geocerca_destino, nombre_destino,
          distancia_km, duracion_avg_min, cantidad_viajes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         distancia_km     = VALUES(distancia_km),
         duracion_avg_min = VALUES(duracion_avg_min),
         cantidad_viajes  = VALUES(cantidad_viajes),
         nombre_origen    = VALUES(nombre_origen),
         nombre_destino   = VALUES(nombre_destino),
         ultima_actualizacion = CURRENT_TIMESTAMP`,
      [origenId, nombreOrigen, destinoId, nombreDestino,
       Math.round(nuevaDistancia * 100) / 100, nuevaDuracion, cantidad]
    );
    log('info', `Ruta actualizada: ${nombreOrigen} → ${nombreDestino} = ${nuevaDistancia.toFixed(1)} km (${cantidad} viajes)`);
  } catch (err) {
    log('error', `Error al persistir ruta: ${err.message}`);
  }
}

// ── Recálculo con media recortada (trimmed mean) ────────────────────────────

/**
 * Recalcula tiempos de viaje para todas las rutas usando media recortada:
 * - Toma todos los viajes completados entre cada par de geocercas
 * - Elimina el 20% superior e inferior (outliers)
 * - Calcula el promedio del 60% central
 * - Actualiza el cache y la DB
 */
export async function recalcularEstadisticasRutas() {
  const pool = db();
  if (!pool) return;

  try {
    // Obtener todas las rutas con suficientes viajes (mínimo 3)
    const [rows] = await pool.execute(`
      SELECT id_geocerca_origen, nombre_geocerca_origen AS nombre_origen,
             id_geocerca_destino, nombre_geocerca_destino AS nombre_destino,
             duracion_min, km_recorridos
      FROM fleetops_viajes_libres
      WHERE estado = 'completado'
        AND id_geocerca_origen IS NOT NULL
        AND id_geocerca_destino IS NOT NULL
        AND duracion_min > 0
        AND duracion_min < 600
      ORDER BY id_geocerca_origen, id_geocerca_destino, duracion_min
    `);

    // Agrupar por par de geocercas
    const rutas = new Map();
    for (const row of rows) {
      const key = rutaKey(row.id_geocerca_origen, row.id_geocerca_destino);
      if (!rutas.has(key)) {
        rutas.set(key, {
          origenId: row.id_geocerca_origen,
          destinoId: row.id_geocerca_destino,
          nombreOrigen: row.nombre_origen,
          nombreDestino: row.nombre_destino,
          duraciones: [],
          distancias: [],
        });
      }
      rutas.get(key).duraciones.push(row.duracion_min);
      if (row.km_recorridos > 0) {
        rutas.get(key).distancias.push(row.km_recorridos);
      }
    }

    let actualizadas = 0;
    for (const [key, data] of rutas.entries()) {
      const n = data.duraciones.length;
      if (n < 3) {
        // Con menos de 3 viajes, usar promedio simple
        const avgDur = Math.round(data.duraciones.reduce((a, b) => a + b, 0) / n);
        const avgDist = data.distancias.length > 0
          ? Math.round((data.distancias.reduce((a, b) => a + b, 0) / data.distancias.length) * 100) / 100
          : _rutasCache.get(key)?.distanciaKm ?? 0;

        _rutasCache.set(key, {
          distanciaKm:       avgDist,
          duracionAvgMin:    avgDur,
          duracionTrimmedMin: avgDur,
          cantidadViajes:    n,
          nombreOrigen:      data.nombreOrigen,
          nombreDestino:     data.nombreDestino,
          minDuracion:       Math.min(...data.duraciones),
          maxDuracion:       Math.max(...data.duraciones),
        });
        continue;
      }

      // Ordenar duraciones y aplicar trimmed mean (quitar 20% superior e inferior)
      const sorted = [...data.duraciones].sort((a, b) => a - b);
      const trimCount = Math.floor(n * 0.2);
      const trimmed = sorted.slice(trimCount, n - trimCount);

      const trimmedAvg = trimmed.length > 0
        ? Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length)
        : Math.round(sorted.reduce((a, b) => a + b, 0) / n);

      const avgDist = data.distancias.length > 0
        ? Math.round((data.distancias.reduce((a, b) => a + b, 0) / data.distancias.length) * 100) / 100
        : _rutasCache.get(key)?.distanciaKm ?? 0;

      _rutasCache.set(key, {
        distanciaKm:       avgDist,
        duracionAvgMin:    Math.round(data.duraciones.reduce((a, b) => a + b, 0) / n),
        duracionTrimmedMin: trimmedAvg,
        cantidadViajes:    n,
        nombreOrigen:      data.nombreOrigen,
        nombreDestino:     data.nombreDestino,
        minDuracion:       sorted[0],
        maxDuracion:       sorted[n - 1],
        p20:               sorted[trimCount],
        p80:               sorted[n - 1 - trimCount],
      });

      // Persistir en DB
      try {
        await pool.execute(
          `INSERT INTO fleetops_rutas_conocidas
             (id_geocerca_origen, nombre_origen, id_geocerca_destino, nombre_destino,
              distancia_km, duracion_avg_min, cantidad_viajes)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             distancia_km     = VALUES(distancia_km),
             duracion_avg_min = VALUES(duracion_avg_min),
             cantidad_viajes  = VALUES(cantidad_viajes),
             ultima_actualizacion = CURRENT_TIMESTAMP`,
          [data.origenId, data.nombreOrigen, data.destinoId, data.nombreDestino,
           avgDist, trimmedAvg, n]
        );
        actualizadas++;
      } catch (_) {}
    }

    log('info', `Estadísticas recalculadas: ${actualizadas} rutas con trimmed mean (${rows.length} viajes analizados)`);
    return { rutasActualizadas: actualizadas, viajesAnalizados: rows.length };
  } catch (err) {
    log('error', `Error recalculando estadísticas: ${err.message}`);
    return { error: err.message };
  }
}

// ── Consulta de rutas conocidas ──────────────────────────────────────────────

export function getRutasConocidas() {
  const resultado = [];
  for (const [key, data] of _rutasCache.entries()) {
    const [origenId, destinoId] = key.split('-').map(Number);
    resultado.push({
      origenId,
      destinoId,
      ...data,
    });
  }
  return resultado.sort((a, b) => b.cantidadViajes - a.cantidadViajes);
}

/**
 * Obtener tiempo estimado de viaje entre dos geocercas.
 * Usa trimmed mean si está disponible, sino el promedio.
 * @returns {{ duracionMin: number, fuente: string, cantidadViajes: number } | null}
 */
export function getTiempoEstimado(origenId, destinoId) {
  const ruta = _rutasCache.get(rutaKey(origenId, destinoId));
  if (!ruta) return null;
  return {
    duracionMin:    ruta.duracionTrimmedMin ?? ruta.duracionAvgMin,
    distanciaKm:    ruta.distanciaKm,
    cantidadViajes: ruta.cantidadViajes,
    minDuracion:    ruta.minDuracion ?? null,
    maxDuracion:    ruta.maxDuracion ?? null,
    p20:            ruta.p20 ?? null,
    p80:            ruta.p80 ?? null,
    fuente:         ruta.cantidadViajes >= 3 ? 'trimmed_mean' : 'promedio',
  };
}

/**
 * Obtener distancia conocida de cache (sin ir a OSRM).
 * Para uso rápido en cálculos de progreso.
 */
export function getDistanciaConocida(origenId, destinoId) {
  return _rutasCache.get(rutaKey(origenId, destinoId)) || null;
}
