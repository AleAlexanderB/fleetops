/**
 * geocercasTemp.js
 *
 * Geocercas temporales para viajes programados.
 * Permite crear puntos personalizados (origen/destino) que no existen
 * como geocercas RedGPS, con un radio configurable.
 * Se detectan en el polling de posiciones cada 30s.
 */

import { db } from '../../database/database.js';

// Cache en memoria: id -> geocerca temporal
const _geocercasTemp = new Map();

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [GeocercasTemp] ${msg}`);
}

// ── Haversine (distancia en metros) ─────────────────────────────────────────

function toRad(deg) { return deg * Math.PI / 180; }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // metros
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

export async function initGeocercasTemp() {
  const pool = db();
  if (!pool) {
    log('warn', 'Sin MySQL — geocercas temporales solo en memoria');
    return;
  }

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM fleetops_geocercas_temp WHERE activo = 1'
    );

    for (const row of rows) {
      _geocercasTemp.set(row.id, {
        id:                 row.id,
        nombre:             row.nombre,
        latitud:            row.latitud,
        longitud:           row.longitud,
        radio:              row.radio,
        viajeProgramadoId:  row.viaje_programado_id,
        tipo:               row.tipo,
        activo:             !!row.activo,
        creadoEn:           row.creado_en?.toISOString?.() ?? row.creado_en,
      });
    }

    log('info', `Cargadas ${rows.length} geocercas temporales activas`);
  } catch (err) {
    log('error', `Error al cargar geocercas temporales: ${err.message}`);
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function crearGeocercaTemp({ nombre, latitud, longitud, radio = 200, viajeProgramadoId = null, tipo = 'destino' }) {
  if (!nombre || latitud == null || longitud == null) {
    throw new Error('nombre, latitud y longitud son requeridos');
  }

  const geocerca = {
    id:                 null,
    nombre,
    latitud:            parseFloat(latitud),
    longitud:           parseFloat(longitud),
    radio:              parseInt(radio) || 200,
    viajeProgramadoId:  viajeProgramadoId ? parseInt(viajeProgramadoId) : null,
    tipo,
    activo:             true,
    creadoEn:           new Date().toISOString(),
  };

  const pool = db();
  if (pool) {
    try {
      const [result] = await pool.execute(
        `INSERT INTO fleetops_geocercas_temp
           (nombre, latitud, longitud, radio, viaje_programado_id, tipo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [geocerca.nombre, geocerca.latitud, geocerca.longitud, geocerca.radio, geocerca.viajeProgramadoId, geocerca.tipo]
      );
      geocerca.id = result.insertId;
    } catch (err) {
      log('error', `Error al insertar geocerca temporal: ${err.message}`);
      throw err;
    }
  } else {
    // Fallback: generar id en memoria
    geocerca.id = Date.now();
  }

  _geocercasTemp.set(geocerca.id, geocerca);
  log('info', `Geocerca temporal creada: #${geocerca.id} "${geocerca.nombre}" (${geocerca.latitud}, ${geocerca.longitud}) radio=${geocerca.radio}m tipo=${geocerca.tipo}`);
  return geocerca;
}

export async function eliminarGeocercaTemp(id) {
  id = parseInt(id);
  const geocerca = _geocercasTemp.get(id);
  if (!geocerca) {
    throw new Error(`Geocerca temporal #${id} no encontrada`);
  }

  // Soft delete en DB
  const pool = db();
  if (pool) {
    try {
      await pool.execute(
        'UPDATE fleetops_geocercas_temp SET activo = 0 WHERE id = ?',
        [id]
      );
    } catch (err) {
      log('error', `Error al desactivar geocerca temporal #${id}: ${err.message}`);
    }
  }

  // Remover de memoria
  _geocercasTemp.delete(id);
  log('info', `Geocerca temporal eliminada: #${id} "${geocerca.nombre}"`);
  return geocerca;
}

// ── Consultas ───────────────────────────────────────────────────────────────

export function getGeocercasTemp() {
  return [..._geocercasTemp.values()];
}

export function getGeocercaTempByViajeId(viajeId) {
  viajeId = parseInt(viajeId);
  return [..._geocercasTemp.values()].filter(g => g.viajeProgramadoId === viajeId);
}

// ── Deteccion de posicion ───────────────────────────────────────────────────

/**
 * Verifica si una posicion (lat, lng) cae dentro del radio de alguna
 * geocerca temporal activa.
 * @returns {object|null} La geocerca temporal coincidente, o null.
 */
export function verificarPosicionEnTemp(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  for (const geo of _geocercasTemp.values()) {
    if (!geo.activo) continue;
    const dist = haversine(lat, lng, geo.latitud, geo.longitud);
    if (dist <= geo.radio) {
      return geo;
    }
  }
  return null;
}

// ── Limpieza ────────────────────────────────────────────────────────────────

/**
 * Desactiva todas las geocercas temporales asociadas a un viaje programado
 * (cuando el viaje se completa o cancela).
 */
export async function limpiarGeocercasViajeCompletado(viajeId) {
  viajeId = parseInt(viajeId);
  const asociadas = [..._geocercasTemp.values()].filter(g => g.viajeProgramadoId === viajeId);

  if (asociadas.length === 0) return;

  const pool = db();
  if (pool) {
    try {
      await pool.execute(
        'UPDATE fleetops_geocercas_temp SET activo = 0 WHERE viaje_programado_id = ?',
        [viajeId]
      );
    } catch (err) {
      log('error', `Error al limpiar geocercas del viaje #${viajeId}: ${err.message}`);
    }
  }

  for (const geo of asociadas) {
    _geocercasTemp.delete(geo.id);
  }

  log('info', `Limpiadas ${asociadas.length} geocercas temporales del viaje #${viajeId}`);
}
