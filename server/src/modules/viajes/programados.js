/**
 * programados.js — Fase 3
 *
 * CRUD de viajes programados con persistencia MySQL.
 * Fallback a memoria si la DB no está disponible.
 */

import { db }                            from '../../database/database.js';
import { getViajesEnCurso, getViajesCompletados, getPosicionActual } from './libres.js';
import { obtenerDistanciaRuta, actualizarRutaReal, getDistanciaConocida, getTiempoEstimado } from './rutas.js';
import { getGeocercas } from '../redgps/geocercas.js';
import { getVehiculoPorCodigo, getVehiculoPorPatente } from '../redgps/vehiculos.js';
import { crearGeocercaTemp, limpiarGeocercasViajeCompletado } from '../geocercas/geocercasTemp.js';

// Cache en memoria (siempre actualizado)
const _cache = new Map();   // id → viaje programado
let   _nextId = 1;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [ViajesProg] ${msg}`);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export async function initViajesProgramados() {
  const pool = db();
  if (!pool) {
    log('warn', 'Sin MySQL — viajes programados solo en memoria');
    return;
  }

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM fleetops_viajes_programados ORDER BY id_viaje_programado ASC'
    );

    for (const row of rows) {
      _cache.set(row.id_viaje_programado, dbRowToViaje(row));
    }

    const [[{ nextId }]] = await pool.execute(
      'SELECT COALESCE(MAX(id_viaje_programado), 0) + 1 AS nextId FROM fleetops_viajes_programados'
    );
    _nextId = nextId;

    log('info', `Restaurados: ${rows.length} viajes programados`);
  } catch (err) {
    log('error', `Error al cargar viajes programados: ${err.message}`);
  }
}

// ── Mapeo DB ↔ objeto ─────────────────────────────────────────────────────────

function dbRowToViaje(row) {
  return {
    id:                    row.id_viaje_programado,
    patente:               row.patente,
    codigoEquipo:          row.codigo_equipo || null,   // v2
    etiqueta:              row.codigo_equipo && !row.patente?.trim()
                             ? row.codigo_equipo
                             : row.patente,              // v2
    chofer:                row.chofer,
    division:              row.division,
    subgrupo:              row.subgrupo,
    geocercaOrigenId:      row.id_geocerca_origen,
    geocercaOrigenNombre:  row.nombre_geocerca_origen,
    geocercaDestinoId:     row.id_geocerca_destino,
    geocercaDestinoNombre: row.nombre_geocerca_destino,
    carga:                 row.carga,
    fechaInicio:           row.fecha_inicio instanceof Date
                             ? row.fecha_inicio.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
                             : row.fecha_inicio,
    horaInicio:            row.hora_inicio,
    cancelado:             !!row.cancelado,
    observaciones:         row.observaciones,
    motivoCancelacion:     row.motivo_cancelacion || null,
    fechaLlegadaEstimada:  row.fecha_llegada_estimada instanceof Date
                             ? row.fecha_llegada_estimada.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
                             : row.fecha_llegada_estimada || null,
    horaLlegadaEstimada:   row.hora_llegada_estimada || null,
    tiempoEnDestinoMin:    row.tiempo_en_destino_min ?? 60,
    // Campos calculados (se llenan en _enriquecer)
    estado:                null,
    viajeLibreId:          row.id_viaje_libre,
    salidaReal:            row.salida_real?.toISOString?.()  ?? row.salida_real,
    llegadaReal:           row.llegada_real?.toISOString?.() ?? row.llegada_real,
    duracionRealMin:       row.duracion_real_min,
    demoraSalidaMin:       row.demora_salida_min,
    kmReales:              row.km_reales ? parseFloat(row.km_reales) : null,
    distanciaEstimadaKm:   row.distancia_estimada_km ? parseFloat(row.distancia_estimada_km) : null,
    fuenteDistancia:       row.fuente_distancia || null,
    origenLat:             row.origen_lat != null ? parseFloat(row.origen_lat) : null,
    origenLng:             row.origen_lng != null ? parseFloat(row.origen_lng) : null,
    origenRadio:           row.origen_radio != null ? parseInt(row.origen_radio) : null,
    destinoLat:            row.destino_lat != null ? parseFloat(row.destino_lat) : null,
    destinoLng:            row.destino_lng != null ? parseFloat(row.destino_lng) : null,
    destinoRadio:          row.destino_radio != null ? parseInt(row.destino_radio) : null,
    cumplimientoPct:       null,
    progresoPct:           null,
    creadoEn:              row.creado_en?.toISOString?.() ?? row.creado_en,
  };
}

// ── Persistencia MySQL ────────────────────────────────────────────────────────

async function insertarEnDB(data) {
  const pool = db();
  if (!pool) return null;
  try {
    const [result] = await pool.execute(
      `INSERT INTO fleetops_viajes_programados
         (patente, codigo_equipo, chofer, division, subgrupo,
          id_geocerca_origen,  nombre_geocerca_origen,
          id_geocerca_destino, nombre_geocerca_destino,
          carga, fecha_inicio, hora_inicio, observaciones,
          distancia_estimada_km, fuente_distancia,
          fecha_llegada_estimada, hora_llegada_estimada,
          tiempo_en_destino_min,
          origen_lat, origen_lng, origen_radio,
          destino_lat, destino_lng, destino_radio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.patente               ?? null,
        data.codigoEquipo          ?? data.patente ?? null,
        data.chofer                ?? null,
        data.division              ?? null,
        data.subgrupo              ?? null,
        data.geocercaOrigenId,
        data.geocercaOrigenNombre,
        data.geocercaDestinoId,
        data.geocercaDestinoNombre,
        data.carga                 ?? null,
        data.fechaInicio,
        data.horaInicio,
        data.observaciones         ?? null,
        data.distanciaEstimadaKm   ?? null,
        data.fuenteDistancia       ?? null,
        data.fechaLlegadaEstimada  ?? null,
        data.horaLlegadaEstimada   ?? null,
        data.tiempoEnDestinoMin    ?? 60,
        data.origenLat             ?? null,
        data.origenLng             ?? null,
        data.origenRadio           ?? null,
        data.destinoLat            ?? null,
        data.destinoLng            ?? null,
        data.destinoRadio          ?? null,
      ]
    );
    return result.insertId;
  } catch (err) {
    log('error', `Error al insertar viaje programado: ${err.message}`);
    return null;
  }
}

async function actualizarEnDB(id, fields) {
  const pool = db();
  if (!pool) return;

  const setCols = [];
  const params  = [];

  const map = {
    patente:               'patente',
    codigoEquipo:          'codigo_equipo',
    chofer:                'chofer',
    division:              'division',
    subgrupo:              'subgrupo',
    geocercaOrigenId:      'id_geocerca_origen',
    geocercaOrigenNombre:  'nombre_geocerca_origen',
    geocercaDestinoId:     'id_geocerca_destino',
    geocercaDestinoNombre: 'nombre_geocerca_destino',
    carga:                 'carga',
    fechaInicio:           'fecha_inicio',
    horaInicio:            'hora_inicio',
    observaciones:         'observaciones',
    cancelado:             'cancelado',
    viajeLibreId:          'id_viaje_libre',
    salidaReal:            'salida_real',
    llegadaReal:           'llegada_real',
    duracionRealMin:       'duracion_real_min',
    demoraSalidaMin:       'demora_salida_min',
    kmReales:              'km_reales',
    distanciaEstimadaKm:   'distancia_estimada_km',
    fuenteDistancia:       'fuente_distancia',
    motivoCancelacion:     'motivo_cancelacion',
    fechaLlegadaEstimada:  'fecha_llegada_estimada',
    horaLlegadaEstimada:   'hora_llegada_estimada',
    tiempoEnDestinoMin:    'tiempo_en_destino_min',
    origenLat:             'origen_lat',
    origenLng:             'origen_lng',
    origenRadio:           'origen_radio',
    destinoLat:            'destino_lat',
    destinoLng:            'destino_lng',
    destinoRadio:          'destino_radio',
  };

  // Columnas datetime que necesitan conversión ISO → MySQL
  const datetimeCols = new Set(['salida_real', 'llegada_real']);

  for (const [key, col] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      let val = fields[key];
      // Convertir ISO 8601 (2026-04-14T15:03:47.000Z) → MySQL DATETIME (2026-04-14 15:03:47)
      if (datetimeCols.has(col) && typeof val === 'string' && val.includes('T')) {
        val = val.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
      }
      setCols.push(`${col} = ?`);
      params.push(val);
    }
  }

  if (!setCols.length) return;
  params.push(id);

  try {
    await pool.execute(
      `UPDATE fleetops_viajes_programados SET ${setCols.join(', ')}, actualizado_en = CURRENT_TIMESTAMP
       WHERE id_viaje_programado = ?`,
      params
    );
  } catch (err) {
    log('error', `Error al actualizar viaje ${id}: ${err.message}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _centroGeocerca(geo) {
  if (!geo.puntos || geo.puntos.length === 0) return null;
  // Para circular, el primer punto es el centro
  if (geo.tipoCerca === 2 && geo.puntos.length >= 1) {
    return { lat: geo.puntos[0].lat, lng: geo.puntos[0].lng };
  }
  // Para poligonal/lineal, promedio de todos los puntos
  let sumLat = 0, sumLng = 0;
  for (const p of geo.puntos) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return {
    lat: sumLat / geo.puntos.length,
    lng: sumLng / geo.puntos.length,
  };
}

// ── Cálculo de estado y cumplimiento ─────────────────────────────────────────

function calcEstado(vp) {
  if (vp.cancelado) return 'cancelado';

  const ahora  = new Date();
  const inicio = new Date(`${vp.fechaInicio}T${vp.horaInicio}-03:00`);

  // Si ya tiene datos reales persistidos en DB, usarlos directamente
  if (vp.viajeLibreId && vp.salidaReal) {
    if (vp.llegadaReal) return 'cumplido';

    // llegadaReal es null → el viaje se vinculó cuando estaba en curso.
    // Re-consultar el viaje libre por si ya se completó desde entonces.
    const viajeActualizado = buscarViajeReal(vp);
    if (viajeActualizado && viajeActualizado.timestampFin) {
      vp.llegadaReal    = viajeActualizado.timestampFin;
      vp.duracionRealMin = viajeActualizado.duracionMin;
      vp.kmReales       = viajeActualizado.kmRecorridos;
      actualizarEnDB(vp.id, {
        llegadaReal:     vp.llegadaReal,
        duracionRealMin: vp.duracionRealMin,
        kmReales:        vp.kmReales,
      }).catch(() => {});
      return 'cumplido';
    }
    return 'en_curso';
  }

  // Buscar en viajes libres en memoria (solo relevante para el día actual)
  const viajeReal = buscarViajeReal(vp);

  if (viajeReal) {
    const diff = Math.round((new Date(viajeReal.timestampInicio) - inicio) / 60000);
    vp.viajeLibreId   = viajeReal.id;
    vp.salidaReal     = viajeReal.timestampInicio;
    vp.llegadaReal    = viajeReal.timestampFin;
    vp.duracionRealMin = viajeReal.duracionMin;
    vp.demoraSalidaMin = diff;
    vp.kmReales       = viajeReal.kmRecorridos;

    // Sincronizar con DB
    vp._viajeRealPersistido = true;
    actualizarEnDB(vp.id, {
      viajeLibreId: vp.viajeLibreId,
      salidaReal:  vp.salidaReal,
      llegadaReal: vp.llegadaReal,
      duracionRealMin: vp.duracionRealMin,
      demoraSalidaMin: vp.demoraSalidaMin,
      kmReales:     vp.kmReales,
    }).catch(() => {});

    if (!viajeReal.timestampFin) return 'en_curso';
    return 'cumplido';
  }

  if (ahora < inicio) return 'pendiente';
  const diffMin = Math.round((ahora - inicio) / 60000);
  return diffMin <= 30 ? 'en_curso' : 'pendiente';
}

function buscarViajeReal(vp) {
  // Tolerancia temporal ±2h para evitar matchear con el viaje equivocado
  const programadoMs = new Date(`${vp.fechaInicio}T${vp.horaInicio}-03:00`).getTime();
  const TOLERANCIA_MS = 2 * 60 * 60 * 1000; // ±2 horas

  // Clave de matching: preferir codigoEquipo, fallback a patente
  const vpKey = (vp.codigoEquipo || vp.patente || '').toUpperCase();

  const todos = [...getViajesEnCurso(), ...getViajesCompletados()];
  return todos.find(vl => {
    const vlKey = (vl.codigoEquipo || vl.codigo || vl.patente || '').toUpperCase();
    if (vlKey !== vpKey) return false;
    if (!vl.timestampInicio?.startsWith(vp.fechaInicio)) return false;

    // Exigir que AMBAS geocercas coincidan (origen Y destino)
    // para evitar matchear viajes cortos que comparten solo un punto
    const origenMatch  = vl.geocercaOrigen?.idCerca  === vp.geocercaOrigenId;
    const destinoMatch = vl.geocercaDestino?.idCerca === vp.geocercaDestinoId;
    if (!origenMatch || !destinoMatch) return false;

    // Verificar tolerancia temporal
    const viajeMs = new Date(vl.timestampInicio).getTime();
    return Math.abs(viajeMs - programadoMs) <= TOLERANCIA_MS;
  }) ?? null;
}

function calcProgreso(vp) {
  // Viaje completado → 100%
  if (vp.llegadaReal) return 100;

  // Viaje en curso → calcular por km recorridos vs distancia estimada
  if (vp.salidaReal && !vp.llegadaReal && vp.distanciaEstimadaKm > 0) {
    // Buscar km recorridos del viaje libre en curso
    const viajeReal = buscarViajeReal(vp);
    if (viajeReal && viajeReal.kmRecorridos > 0) {
      const pct = Math.min(95, Math.round((viajeReal.kmRecorridos / vp.distanciaEstimadaKm) * 100));
      return Math.max(5, pct); // Mínimo 5% si ya salió
    }
    return 5; // Salió pero sin km aún
  }

  // Si no tenemos distancia estimada pero está en curso, usar tiempo
  if (vp.estado === 'en_curso' || (vp.salidaReal && !vp.llegadaReal)) {
    return 5; // Al menos salió
  }

  if (vp.estado === 'pendiente') return 0;
  if (vp.estado === 'cancelado') return null;

  return null;
}

function _calcDistanciaRestante(vp) {
  // Solo para viajes en curso con destino conocido
  if (!vp.salidaReal || vp.llegadaReal) return null;

  const codigo = vp.codigoEquipo || vp.patente;
  if (!codigo) return null;

  const pos = getPosicionActual(codigo);
  if (!pos) return null;

  // Obtener centro del destino
  let destLat, destLng;
  if (vp.destino_lat && vp.destino_lng) {
    destLat = vp.destino_lat;
    destLng = vp.destino_lng;
  } else if (vp.geocercaDestinoId) {
    const geocercas = getGeocercas();
    const geoDest = geocercas.find(g => g.idCerca === vp.geocercaDestinoId);
    if (!geoDest) return null;
    const centro = _centroGeocerca(geoDest);
    if (!centro) return null;
    destLat = centro.lat;
    destLng = centro.lng;
  } else {
    return null;
  }

  return Math.round(_haversineKm(pos.lat, pos.lng, destLat, destLng) * 10) / 10;
}

function _resolverEmpresa(vp) {
  if (vp.empresa) return vp.empresa;
  const vehiculo = (vp.codigoEquipo && getVehiculoPorCodigo(vp.codigoEquipo))
                || (vp.patente && getVehiculoPorPatente(vp.patente));
  return vehiculo?.empresa ?? null;
}

function _estadoVehiculo(vp) {
  if (!vp.salidaReal || vp.llegadaReal) return null;
  const vehiculo = (vp.codigoEquipo && getVehiculoPorCodigo(vp.codigoEquipo))
                || (vp.patente && getVehiculoPorPatente(vp.patente));
  if (!vehiculo) return null;
  return {
    estadoVehiculo: vehiculo.estado ?? null,
    velocidad:      vehiculo.velocidad ?? 0,
    geocercaActual: vehiculo.geocercaActual ?? null,
  };
}

function _enriquecer(vp) {
  // calcEstado puede actualizar campos reales (salidaReal, llegadaReal, etc.)
  // Debe operar sobre el original del cache para persistir cambios entre llamadas
  const estado = calcEstado(vp);
  const copia = { ...vp };
  copia.estado = estado;
  copia.progresoPct = calcProgreso(copia);
  copia.distanciaRestanteKm = _calcDistanciaRestante(copia);
  copia.empresa     = _resolverEmpresa(copia);
  const ev = _estadoVehiculo(copia);
  if (ev) {
    copia.estadoVehiculo = ev.estadoVehiculo;
    copia.velocidadActual = ev.velocidad;
    copia.geocercaActual  = ev.geocercaActual;
  }

  // Duración estimada de viaje usando trimmed mean de rutas históricas
  if (copia.geocercaOrigenId && copia.geocercaDestinoId) {
    const est = getTiempoEstimado(copia.geocercaOrigenId, copia.geocercaDestinoId);
    if (est) {
      copia.duracionEstimadaMin = est.duracionMin;
      copia.fuenteDuracion      = est.fuente;       // 'trimmed_mean' | 'promedio'
      copia.cantidadViajesRuta  = est.cantidadViajes;
    } else {
      // Fallback: estimar con distancia / 40 km/h
      copia.duracionEstimadaMin = copia.distanciaEstimadaKm
        ? Math.round((copia.distanciaEstimadaKm / 40) * 60)
        : null;
      copia.fuenteDuracion = copia.duracionEstimadaMin ? 'distancia' : null;
      copia.cantidadViajesRuta = 0;
    }
  }

  // No exponer flag interno
  delete copia._viajeRealPersistido;
  return copia;
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function crearViajeProgramado(data) {
  const id    = _nextId++;

  // Obtener distancia estimada de la ruta
  let distanciaEstimadaKm = null;
  let fuenteDistancia = null;

  if (data.geocercaOrigenId && data.geocercaDestinoId) {
    try {
      // Obtener centro de geocercas desde sus puntos
      const geocercas = getGeocercas();
      const geoOrigen  = geocercas.find(g => g.idCerca === data.geocercaOrigenId);
      const geoDestino = geocercas.find(g => g.idCerca === data.geocercaDestinoId);

      const origenCoords  = geoOrigen  ? _centroGeocerca(geoOrigen)  : null;
      const destinoCoords = geoDestino ? _centroGeocerca(geoDestino) : null;

      const ruta = await obtenerDistanciaRuta(
        data.geocercaOrigenId, data.geocercaDestinoId,
        origenCoords, destinoCoords
      );

      if (ruta.distanciaKm) {
        distanciaEstimadaKm = Math.round(ruta.distanciaKm * 100) / 100;
        fuenteDistancia = ruta.fuente;
        log('info', `Distancia estimada ${data.geocercaOrigenNombre} → ${data.geocercaDestinoNombre}: ${distanciaEstimadaKm} km (${fuenteDistancia})`);
      }
    } catch (err) {
      log('warn', `No se pudo obtener distancia de ruta: ${err.message}`);
    }
  }

  const viaje = {
    id,
    patente:               data.patente              ?? null,
    codigoEquipo:          data.codigoEquipo         ?? data.patente ?? null,
    etiqueta:              data.etiqueta             ?? data.codigoEquipo ?? data.patente ?? null,
    chofer:                data.chofer               ?? null,
    division:              data.division             ?? null,
    subgrupo:              data.subgrupo             ?? null,
    geocercaOrigenId:      data.geocercaOrigenId,
    geocercaOrigenNombre:  data.geocercaOrigenNombre,
    geocercaDestinoId:     data.geocercaDestinoId,
    geocercaDestinoNombre: data.geocercaDestinoNombre,
    carga:                 data.carga               ?? null,
    fechaInicio:           data.fechaInicio,
    horaInicio:            data.horaInicio           ?? '08:00:00',
    observaciones:         data.observaciones        ?? null,
    fechaLlegadaEstimada:  data.fechaLlegadaEstimada ?? null,
    horaLlegadaEstimada:   data.horaLlegadaEstimada  ?? null,
    tiempoEnDestinoMin:    data.tiempoEnDestinoMin   ?? 60,
    cancelado:             false,
    estado:                null,
    viajeLibreId:          null,
    salidaReal:            null,
    llegadaReal:           null,
    duracionRealMin:       null,
    demoraSalidaMin:       null,
    kmReales:              null,
    distanciaEstimadaKm,
    fuenteDistancia,
    origenLat:             data.origenLat  != null ? parseFloat(data.origenLat)  : null,
    origenLng:             data.origenLng  != null ? parseFloat(data.origenLng)  : null,
    origenRadio:           data.origenRadio != null ? parseInt(data.origenRadio) : null,
    destinoLat:            data.destinoLat != null ? parseFloat(data.destinoLat) : null,
    destinoLng:            data.destinoLng != null ? parseFloat(data.destinoLng) : null,
    destinoRadio:          data.destinoRadio != null ? parseInt(data.destinoRadio) : null,
    progresoPct:           null,
    cumplimientoPct:       null,
    creadoEn:              new Date().toISOString(),
    _viajeRealPersistido:  false,
  };

  const dbId = await insertarEnDB(viaje);
  if (dbId) viaje.id = dbId;

  _cache.set(viaje.id, viaje);

  // Crear geocercas temporales si hay coordenadas custom
  try {
    if (data.origenLat != null && data.origenLng != null) {
      await crearGeocercaTemp({
        nombre:            `Origen: ${data.geocercaOrigenNombre || 'Punto personalizado'}`,
        latitud:           data.origenLat,
        longitud:          data.origenLng,
        radio:             data.origenRadio || 200,
        viajeProgramadoId: viaje.id,
        tipo:              'origen',
      });
    }
    if (data.destinoLat != null && data.destinoLng != null) {
      await crearGeocercaTemp({
        nombre:            `Destino: ${data.geocercaDestinoNombre || 'Punto personalizado'}`,
        latitud:           data.destinoLat,
        longitud:          data.destinoLng,
        radio:             data.destinoRadio || 200,
        viajeProgramadoId: viaje.id,
        tipo:              'destino',
      });
    }
  } catch (err) {
    log('warn', `Error creando geocercas temporales para viaje #${viaje.id}: ${err.message}`);
  }

  log('info', `Viaje programado creado: #${viaje.id} · ${viaje.codigoEquipo || viaje.patente} · ${viaje.fechaInicio}${distanciaEstimadaKm ? ` · ${distanciaEstimadaKm}km (${fuenteDistancia})` : ''}`);
  return _enriquecer(viaje);
}

export async function actualizarViajeProgramado(id, data) {
  const vp = _cache.get(id);
  if (!vp)           throw new Error(`Viaje programado #${id} no encontrado`);
  if (vp.cancelado)  throw new Error('No se puede modificar un viaje cancelado');

  const updates = {};
  const campos = [
    'patente','codigoEquipo','chofer','division','subgrupo',
    'geocercaOrigenId','geocercaOrigenNombre',
    'geocercaDestinoId','geocercaDestinoNombre',
    'carga','fechaInicio','horaInicio','observaciones',
    'fechaLlegadaEstimada','horaLlegadaEstimada','tiempoEnDestinoMin',
    'origenLat','origenLng','origenRadio',
    'destinoLat','destinoLng','destinoRadio',
  ];

  for (const campo of campos) {
    if (data[campo] !== undefined) {
      vp[campo]      = data[campo];
      updates[campo] = data[campo];
    }
  }

  // Si cambiaron campos que afectan el matching, limpiar vínculo real anterior
  const tripFieldsChanged = ['geocercaOrigenId', 'geocercaDestinoId', 'fechaInicio', 'horaInicio']
    .some(f => data[f] !== undefined);
  if (tripFieldsChanged) {
    vp.viajeLibreId       = null;
    vp.salidaReal         = null;
    vp.llegadaReal        = null;
    vp.duracionRealMin    = null;
    vp.demoraSalidaMin    = null;
    vp.kmReales           = null;
    vp._viajeRealPersistido = false;
    updates.viajeLibreId    = null;
    updates.salidaReal      = null;
    updates.llegadaReal     = null;
    updates.duracionRealMin = null;
    updates.demoraSalidaMin = null;
    updates.kmReales        = null;
  }

  await actualizarEnDB(id, updates);
  return _enriquecer(vp);
}

export async function cancelarViajeProgramado(id, motivo) {
  const vp = _cache.get(id);
  if (!vp) throw new Error(`Viaje programado #${id} no encontrado`);
  vp.cancelado = true;

  const updates = { cancelado: 1 };
  if (motivo) {
    vp.motivoCancelacion = motivo;
    updates.motivoCancelacion = motivo;
    // También agregar al campo observaciones para visibilidad
    const obsAnterior = vp.observaciones ? vp.observaciones + ' | ' : '';
    vp.observaciones = obsAnterior + `CANCELADO: ${motivo}`;
    updates.observaciones = vp.observaciones;
  }

  await actualizarEnDB(id, updates);

  // Limpiar geocercas temporales asociadas
  try {
    await limpiarGeocercasViajeCompletado(id);
  } catch (err) {
    log('warn', `Error limpiando geocercas temporales del viaje #${id}: ${err.message}`);
  }

  return _enriquecer(vp);
}

export function getViajesProgramados({ fecha, patente, codigoEquipo, division, estado, empresa } = {}) {
  let lista = [..._cache.values()].map(_enriquecer);
  if (empresa)      lista = lista.filter(v => v.empresa === empresa);
  if (fecha)        lista = lista.filter(v => v.fechaInicio === fecha);
  if (codigoEquipo) lista = lista.filter(v => v.codigoEquipo === codigoEquipo);
  else if (patente) lista = lista.filter(v => v.patente      === patente);
  if (division)     lista = lista.filter(v => v.division     === division);
  if (estado)       lista = lista.filter(v => v.estado       === estado);
  return lista.sort((a, b) => {
    const ta = `${a.fechaInicio}T${a.horaInicio}`;
    const tb = `${b.fechaInicio}T${b.horaInicio}`;
    return tb.localeCompare(ta);
  });
}

export function getResumenProgramados(filters = {}) {
  const lista = getViajesProgramados(filters);
  return {
    total:     lista.length,
    pendiente: lista.filter(v => v.estado === 'pendiente').length,
    en_curso:  lista.filter(v => v.estado === 'en_curso').length,
    cumplido:  lista.filter(v => v.estado === 'cumplido').length,
    cancelado: lista.filter(v => v.estado === 'cancelado').length,
  };
}

/**
 * Consulta histórica de viajes programados en DB con rango de fechas.
 * Los viajes del día actual los sirve el cache en memoria (_cache).
 */
export async function getViajesProgramadosDB({ patente, codigoEquipo, division, desde, hasta, estado, empresa, page = 1, pageSize = 50 } = {}) {
  const pool = db();
  if (!pool) {
    // Fallback a memoria
    return { data: getViajesProgramados({ patente, division, estado, empresa }), total: _cache.size, source: 'memory' };
  }

  const where  = [];
  const params = [];

  if (patente)      { where.push('patente = ?');                  params.push(patente); }
  if (codigoEquipo) { where.push('codigo_equipo = ?');            params.push(codigoEquipo); }
  if (division)     { where.push('division = ?');                 params.push(division); }
  if (desde)        { where.push('fecha_inicio >= ?');            params.push(desde); }
  if (hasta)        { where.push('fecha_inicio <= ?');            params.push(hasta); }
  if (estado === 'cancelado') {
    where.push('cancelado = 1');
  } else if (estado) {
    // Para estados calculados (pendiente, cumplido, retrasado) no podemos filtrar
    // directo en SQL — se calculan en runtime. Traemos todos y filtramos en memoria.
  }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const offset   = (page - 1) * pageSize;

  try {
    // Para estados calculados (no-cancelado), traer todos y paginar en memoria
    // porque el estado se calcula en runtime y no se puede filtrar en SQL
    if (estado && estado !== 'cancelado') {
      const [allRows] = await pool.execute(
        `SELECT * FROM fleetops_viajes_programados ${whereStr}
         ORDER BY fecha_inicio DESC, hora_inicio DESC`,
        params
      );
      let allData = allRows.map(dbRowToViaje).map(_enriquecer);
      if (empresa) allData = allData.filter(v => v.empresa === empresa);
      allData = allData.filter(v => v.estado === estado);
      const sliced = allData.slice(offset, offset + pageSize);
      return { data: sliced, total: allData.length, page, pageSize, source: 'mysql' };
    }

    // Para otros casos, paginación normal en SQL
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM fleetops_viajes_programados ${whereStr}`,
      params
    );
    const [rows] = await pool.execute(
      `SELECT * FROM fleetops_viajes_programados ${whereStr}
       ORDER BY fecha_inicio DESC, hora_inicio DESC LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}`,
      params
    );

    let data = rows.map(dbRowToViaje).map(_enriquecer);
    if (empresa) data = data.filter(v => v.empresa === empresa);
    return { data, total: empresa ? data.length : parseInt(total), page, pageSize, source: 'mysql' };
  } catch (err) {
    log('error', `Error en consulta histórica programados: ${err.message}`);
    return { data: [], total: 0, error: err.message };
  }
}
