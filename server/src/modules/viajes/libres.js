/**
 * libres.js — v3 final
 *
 * Construye viajes libres a partir de alertas getAlerts de RedGPS.
 * CLAVE INTERNA: codigo del equipo (ej: "A021") — único identificador garantizado
 * para toda la flota incluyendo maquinaria sin patente.
 *
 * MODELO: Sale de A → [tránsito] → Ingresa B + permanece ≥ MINUTOS_PARADA → VIAJE A→B
 *
 * TIMER INTELIGENTE: si la alerta viene del pasado y ya transcurrió el tiempo
 * de permanencia, se confirma directamente sin esperar.
 */

import { db }                              from '../../database/database.js';
import { registrarIngreso, registrarSalida } from '../redgps/geocercas.js';
import { seedProcesadas }                  from '../redgps/alertas.js';
import { getOdometro, getVehiculoPorCodigo, getVehiculos } from '../redgps/vehiculos.js';
import { actualizarRutaReal } from './rutas.js';
import { buscarTarifa } from '../tarifas/tarifas.js';

const MINUTOS_PARADA = parseInt(process.env.MINUTOS_PARADA_DESTINO) || 5;
const MS_PARADA      = MINUTOS_PARADA * 60 * 1000;

// Umbral para cerrar viajes "zombies": un libre que arrancó hace más de
// HORAS_ABANDONO sin llegar a destino se marca 'abandonado' automáticamente.
// 48h cubre los viajes largos legítimos (LOMA NEGRA → CATUA, etc.) y atrapa
// los que quedaron abiertos por eventos perdidos del motor.
const HORAS_ABANDONO = parseInt(process.env.HORAS_ABANDONO_VIAJE) || 48;

// Maps en memoria — keyed por codigo del equipo
const _enCurso   = new Map();  // codigo → viaje abierto
const _pendiente = new Map();  // codigo → { geocerca, tsEntrada, tsEntradaMs, timeoutId }
const _historial = [];
let   _nextId    = 1;

// Tracker de distancia por GPS para viajes en curso
const _distTracker = new Map();  // codigo → { lastLat, lastLng, totalKm }

// Hook que se dispara cuando un viaje libre se confirma como completado.
// Lo usa programados.js para vincular reactivamente sin depender de que
// alguien consulte la pantalla.
let _onViajeCompletado = null;
export function registrarOnViajeCompletado(cb) { _onViajeCompletado = cb; }

// Hook que se dispara cuando un viaje libre arranca (sale de una geocerca).
// Lo usa programados.js para cerrar la descarga del viaje programado anterior
// (cuyo destino coincide con la geocerca origen del nuevo viaje libre).
let _onViajeIniciado = null;
export function registrarOnViajeIniciado(cb) { _onViajeIniciado = cb; }

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [ViajesLibres] ${msg}`);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export async function initViajesLibres() {
  const pool = db();
  if (!pool) { log('warn', 'Sin MySQL — viajes libres solo en memoria'); return; }

  // Antes de cargar, cerrar zombies viejos para que no contaminen el cache
  // y para destrabar programados que quedaron vinculados a libres sin cerrar.
  await cerrarViajesAbandonados();

  // Cleanup periódico cada hora — previene zombies futuros sin esperar reinicio.
  setInterval(() => {
    cerrarViajesAbandonados().catch(err =>
      log('warn', `cleanup zombies periódico: ${err.message}`));
  }, 60 * 60 * 1000);

  try {
    const hoy = _fechaHoyAR();

    const [completados] = await pool.execute(
      `SELECT * FROM fleetops_viajes_libres
       WHERE DATE(timestamp_inicio) = ? AND estado IN ('completado','en_transito')
       ORDER BY id_viaje_libre ASC`,
      [hoy]
    );
    for (const row of completados) _historial.push(dbRowToViaje(row));

    const [enCurso] = await pool.execute(
      `SELECT * FROM fleetops_viajes_libres WHERE estado='en_curso'
       ORDER BY id_viaje_libre ASC`
    );
    for (const row of enCurso) {
      const clave = row.codigo_equipo || row.patente;
      _enCurso.set(clave, dbRowToViaje(row));
    }

    const [[{ next_id }]] = await pool.execute(
      'SELECT COALESCE(MAX(id_viaje_libre),0)+1 AS next_id FROM fleetops_viajes_libres'
    );
    _nextId = next_id;

    // Sembrar deduplicación de alertas con los viajes ya cargados del día
    // para evitar duplicados si el servidor se reinicia a mitad del día
    const clavesDedup = [];
    const todosDelDia = [...completados, ...enCurso];
    for (const row of todosDelDia) {
      const codigo = row.codigo_equipo || row.patente;
      if (!codigo) continue;
      // Reconstruir claves de dedup para eventos sale/ingresa
      const tsInicio = row.timestamp_inicio instanceof Date
        ? row.timestamp_inicio : new Date(row.timestamp_inicio);
      const fecha = tsInicio.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      const hora  = tsInicio.toLocaleTimeString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires' });
      if (row.nombre_geocerca_origen) {
        clavesDedup.push(`${codigo}|${fecha}|${hora}|sale|${row.nombre_geocerca_origen}`);
      }
      if (row.nombre_geocerca_destino) {
        const tsFin = row.timestamp_fin instanceof Date
          ? row.timestamp_fin : (row.timestamp_fin ? new Date(row.timestamp_fin) : null);
        if (tsFin) {
          const fechaFin = tsFin.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
          const horaFin  = tsFin.toLocaleTimeString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires' });
          clavesDedup.push(`${codigo}|${fechaFin}|${horaFin}|ingresa|${row.nombre_geocerca_destino}`);
        }
      }
    }
    seedProcesadas(clavesDedup);

    log('info', `Restaurados: ${completados.length} completados, ${enCurso.length} en curso. Umbral: ${MINUTOS_PARADA}min`);
  } catch (err) {
    log('error', `Error al cargar desde MySQL: ${err.message}`);
  }
}

function _fechaHoyAR() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * Marca como 'abandonado' los viajes libres que llevan demasiado tiempo
 * abiertos sin llegar a destino. Casos típicos: el camión salió antes
 * de cumplir el umbral de permanencia, o se perdió el evento "Ingresa".
 * Sin este cleanup, el viaje queda zombie y los programados vinculados
 * muestran "en curso" eternamente.
 */
export async function cerrarViajesAbandonados() {
  const pool = db();
  if (!pool) return 0;
  try {
    const [result] = await pool.execute(
      `UPDATE fleetops_viajes_libres
          SET estado = 'abandonado',
              timestamp_fin = NOW(),
              duracion_min = TIMESTAMPDIFF(MINUTE, timestamp_inicio, NOW())
        WHERE estado IN ('en_curso','en_transito')
          AND timestamp_inicio < (NOW() - INTERVAL ${HORAS_ABANDONO} HOUR)`
    );
    if (result.affectedRows > 0) {
      log('warn', `Cerrados ${result.affectedRows} viajes abandonados (>${HORAS_ABANDONO}h sin destino confirmado)`);
    }
    return result.affectedRows;
  } catch (err) {
    log('error', `cerrarViajesAbandonados: ${err.message}`);
    return 0;
  }
}

// ── Mapeo DB ↔ objeto ─────────────────────────────────────────────────────────

function dbRowToViaje(row) {
  return {
    id:              row.id_viaje_libre,
    codigo:          row.codigo_equipo || row.patente,
    patente:         row.patente         || null,
    codigoEquipo:    row.codigo_equipo   || null,
    etiqueta:        row.patente?.trim() || row.codigo_equipo || '—',
    chofer:          row.chofer,
    choferId:        row.id_chofer_redgps,
    division:        row.division,
    subgrupo:        row.subgrupo,
    geocercaOrigen:  row.id_geocerca_origen
                       ? { idCerca: row.id_geocerca_origen, nombre: row.nombre_geocerca_origen }
                       : null,
    geocercaDestino: row.id_geocerca_destino
                       ? { idCerca: row.id_geocerca_destino, nombre: row.nombre_geocerca_destino }
                       : null,
    timestampInicio: row.timestamp_inicio?.toISOString?.() ?? row.timestamp_inicio,
    timestampFin:    row.timestamp_fin?.toISOString?.()    ?? row.timestamp_fin,
    duracionMin:     row.duracion_min,
    kmRecorridos:    row.km_recorridos ? parseFloat(row.km_recorridos) : null,
    estado:          row.estado,
  };
}

// ── Persistencia ──────────────────────────────────────────────────────────────

async function insertarViaje(viaje) {
  const pool = db();
  if (!pool) return viaje;
  try {
    const [result] = await pool.execute(
      `INSERT INTO fleetops_viajes_libres
         (patente, codigo_equipo, chofer, id_chofer_redgps, division, subgrupo,
          id_geocerca_origen, nombre_geocerca_origen,
          id_geocerca_destino, nombre_geocerca_destino,
          timestamp_inicio, estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'en_curso')`,
      [
        viaje.patente                  ?? null,
        viaje.codigo                   ?? null,
        viaje.chofer                   ?? null,
        viaje.choferId                 ?? null,
        viaje.division                 ?? null,
        viaje.subgrupo                 ?? null,
        viaje.geocercaOrigen?.idCerca  ?? null,
        viaje.geocercaOrigen?.nombre   ?? null,
        null,  // destino se llena al cerrar
        null,
        viaje.timestampInicio,
      ]
    );
    viaje.id = result.insertId;
  } catch (err) {
    log('error', `insertarViaje: ${err.message}`);
  }
  return viaje;
}

async function cerrarViajeEnDB(viaje) {
  const pool = db();
  if (!pool || !viaje.id) return;
  try {
    await pool.execute(
      `UPDATE fleetops_viajes_libres SET
         id_geocerca_destino=?, nombre_geocerca_destino=?,
         timestamp_fin=?, duracion_min=?, km_recorridos=?,
         estado='completado', actualizado_en=CURRENT_TIMESTAMP
       WHERE id_viaje_libre=?`,
      [
        viaje.geocercaDestino?.idCerca ?? null,
        viaje.geocercaDestino?.nombre  ?? null,
        viaje.timestampFin,
        viaje.duracionMin,
        viaje.kmRecorridos ?? null,
        viaje.id,
      ]
    );
  } catch (err) {
    log('error', `cerrarViaje ${viaje.id}: ${err.message}`);
  }
}

async function actualizarEstadoEnDB(id, estado) {
  const pool = db();
  if (!pool || !id) return;
  try {
    await pool.execute(
      `UPDATE fleetops_viajes_libres SET estado=?, actualizado_en=CURRENT_TIMESTAMP
       WHERE id_viaje_libre=?`,
      [estado, id]
    );
  } catch (err) {
    log('error', `actualizarEstado ${id}: ${err.message}`);
  }
}

// ── Motor de confirmación ─────────────────────────────────────────────────────

/**
 * Confirma que un equipo se detuvo en una geocerca el tiempo suficiente.
 * @param {string} clave    - codigo del equipo (key del Map)
 * @param {object} geocerca - { idCerca, nombre }
 * @param {string} tsEntrada - timestamp ISO del momento en que entró
 */
async function _confirmarLlegada(clave, geocerca, tsEntrada) {
  _pendiente.delete(clave);
  registrarIngreso(geocerca.idCerca, clave);

  const viaje = _enCurso.get(clave);
  if (viaje) {
    viaje.geocercaDestino = geocerca;
    viaje.timestampFin    = tsEntrada;
    viaje.duracionMin     = calcDuracion(viaje.timestampInicio, tsEntrada);

    // Calcular km recorridos: GPS tracker (posiciones acumuladas) o odómetro
    const tracker = _distTracker.get(clave);
    if (tracker && tracker.totalKm > 0.1) {
      viaje.kmRecorridos = Math.round(tracker.totalKm * 10) / 10;
    } else {
      // Fallback: odómetro
      const odometroFin = getOdometro(clave);
      if (viaje.odometroInicio != null && odometroFin != null) {
        let km = parseFloat(odometroFin) - parseFloat(viaje.odometroInicio);
        // Detectar si está en metros (valor > 100000) y convertir
        if (Math.abs(km) > 100000) km = km / 1000;
        viaje.kmRecorridos = km > 0 && km < 10000 ? Math.round(km * 10) / 10 : null;
      }
    }
    _distTracker.delete(clave);  // limpiar tracker al cerrar viaje

    viaje.estado = 'completado';
    await cerrarViajeEnDB(viaje);
    _historial.push({ ...viaje });
    _enCurso.delete(clave);
    log('info', `✓ Viaje: ${viaje.etiqueta} | "${viaje.geocercaOrigen?.nombre ?? '?'}" → "${geocerca.nombre}" | ${viaje.duracionMin}min | ${viaje.kmRecorridos ?? '?'}km`);

    // Actualizar ruta conocida con distancia GPS real
    if (viaje.geocercaOrigen?.idCerca && geocerca.idCerca && viaje.kmRecorridos > 0) {
      actualizarRutaReal(
        viaje.geocercaOrigen.idCerca, viaje.geocercaOrigen.nombre,
        geocerca.idCerca, geocerca.nombre,
        viaje.kmRecorridos, viaje.duracionMin
      ).catch(err => log('warn', `Error al actualizar ruta: ${err.message}`));
    }

    // Hook reactivo: notificar a programados.js que este viaje quedó cerrado
    // para que vincule el programado correspondiente sin depender de que
    // alguien abra la pantalla.
    if (_onViajeCompletado) {
      Promise.resolve(_onViajeCompletado(viaje))
        .catch(err => log('warn', `hook onViajeCompletado: ${err.message}`));
    }
  } else {
    log('info', `Parada inicial confirmada: ${clave} en "${geocerca.nombre}"`);
  }
}

function _cancelarPendiente(clave) {
  const p = _pendiente.get(clave);
  if (p) {
    clearTimeout(p.timeoutId);
    _pendiente.delete(clave);
    log('info', `⚡ Parada descartada: ${clave} salió de "${p.geocerca.nombre}" (< ${MINUTOS_PARADA}min)`);
  }
}

// ── Procesador principal ──────────────────────────────────────────────────────

/**
 * Procesa una alerta Sale/Ingresa recibida de getAlerts.
 * @param {object} vehiculo  - objeto vehículo con .codigo, .patente, .etiqueta, etc.
 * @param {'sale'|'ingresa'} tipo
 * @param {object} geocerca  - { idCerca, nombre }
 * @param {string} timestamp - ISO: "2026-04-08T07:08:46"
 */
export async function procesarAlertaRedGPS({ vehiculo, tipo, geocerca, timestamp }) {
  // Clave única y consistente — codigo si existe, patente como último recurso
  const clave = vehiculo.codigo || vehiculo.patente;
  if (!clave) {
    log('warn', `Alerta ignorada: vehículo sin codigo ni patente`);
    return;
  }

  if (tipo === 'sale') {
    registrarSalida(geocerca.idCerca, clave);

    // Si había timer pendiente → cancelar (salió antes de confirmar parada)
    if (_pendiente.has(clave)) {
      _cancelarPendiente(clave);
    }

    if (!_enCurso.has(clave)) {
      // Verificar que no exista un viaje con el MISMO timestamp exacto (dedup de evento)
      const pool = db();
      if (pool) {
        try {
          const [existing] = await pool.execute(
            `SELECT id_viaje_libre FROM fleetops_viajes_libres
             WHERE codigo_equipo = ? AND timestamp_inicio = ?
             AND id_geocerca_origen = ?
             LIMIT 1`,
            [clave, timestamp, geocerca.idCerca]
          );
          if (existing.length > 0) {
            log('info', `Viaje duplicado evitado: ${clave} mismo timestamp desde "${geocerca.nombre}"`);
            return;
          }
        } catch (err) {
          log('warn', `Error verificando duplicado: ${err.message}`);
        }
      }
      // Abrir viaje: esta geocerca es el origen
      const odometroInicio = getOdometro(clave);
      const viaje = {
        id:              _nextId++,
        codigo:          vehiculo.codigo   || null,
        patente:         vehiculo.patente  || null,
        codigoEquipo:    vehiculo.codigo   || null,
        etiqueta:        vehiculo.etiqueta || vehiculo.codigo || clave,
        chofer:          vehiculo.chofer?.nombre || vehiculo.conductor || null,
        choferId:        vehiculo.chofer?.id     || null,
        division:        vehiculo.division  || null,
        subgrupo:        vehiculo.subgrupo  || null,
        geocercaOrigen:  geocerca,
        geocercaDestino: null,
        timestampInicio: timestamp,
        timestampFin:    null,
        duracionMin:     null,
        kmRecorridos:    null,
        odometroInicio:  odometroInicio,
        estado:          'en_curso',
      };
      await insertarViaje(viaje);
      _enCurso.set(clave, viaje);
      _distTracker.delete(clave);  // reset tracker al iniciar viaje
      log('info', `Viaje abierto: ${viaje.etiqueta} salió de "${geocerca.nombre}"`);

      // Hook: notificar a programados.js que este equipo salió de geocercaOrigen.
      // Si hay un viaje programado cumplido cuyo destino == esta geocerca, cerrar
      // la descarga (calcular descarga_real_min).
      if (_onViajeIniciado) {
        try { _onViajeIniciado(clave, geocerca.idCerca, timestamp); }
        catch (e) { log('warn', `_onViajeIniciado falló: ${e.message}`); }
      }
    } else {
      const viaje = _enCurso.get(clave);
      if (viaje.estado !== 'en_transito') {
        viaje.estado = 'en_transito';
        await actualizarEstadoEnDB(viaje.id, 'en_transito');
      }
    }

  } else if (tipo === 'ingresa') {
    // Si hay timer pendiente para OTRA geocerca → cancelar
    const pend = _pendiente.get(clave);
    if (pend && pend.geocerca.idCerca !== geocerca.idCerca) {
      _cancelarPendiente(clave);
    }

    // Solo iniciar confirmación si hay viaje abierto y no hay timer ya corriendo
    if (_enCurso.has(clave) && !_pendiente.has(clave)) {
      const ahoraMs      = Date.now();
      const tsEntradaMs  = new Date(timestamp).getTime();
      const transcurrido = ahoraMs - tsEntradaMs;

      if (transcurrido >= MS_PARADA) {
        // Alerta del pasado — la permanencia ya ocurrió → confirmar directo
        log('info', `✓ Entrada pasada (${Math.round(transcurrido / 60000)}min) → directo: ${clave} en "${geocerca.nombre}"`);
        await _confirmarLlegada(clave, geocerca, timestamp);
      } else {
        // Entrada reciente → timer por el tiempo restante
        const restante = MS_PARADA - transcurrido;
        log('info', `⏱ ${vehiculo.etiqueta} entró a "${geocerca.nombre}" — esperando ${Math.round(restante / 1000)}s más...`);
        const timeoutId = setTimeout(
          () => _confirmarLlegada(clave, geocerca, timestamp),
          restante
        );
        _pendiente.set(clave, { geocerca, tsEntrada: timestamp, tsEntradaMs, timeoutId });
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcDuracion(inicio, fin) {
  try { return Math.round((new Date(fin) - new Date(inicio)) / 60000); }
  catch { return null; }
}

// ── Calculo de distancia GPS ─────────────────────────────────────────────────

function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;  // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Actualiza la distancia recorrida de un viaje en curso.
 * Se llama desde posiciones.js en cada poll para acumular km.
 */
export function actualizarPosicionViaje(codigo, lat, lng) {
  if (!codigo || !_enCurso.has(codigo)) return;
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;

  let tracker = _distTracker.get(codigo);
  if (!tracker) {
    tracker = { lastLat: lat, lastLng: lng, totalKm: 0 };
    _distTracker.set(codigo, tracker);
    return;
  }

  const dist = _haversineKm(tracker.lastLat, tracker.lastLng, lat, lng);
  // Ignorar saltos > 200km (GPS glitch) y < 0.01km (ruido estacionario)
  if (dist >= 0.01 && dist < 200) {
    tracker.totalKm += dist;
  }
  tracker.lastLat = lat;
  tracker.lastLng = lng;
}

/** Posición actual de un vehículo en viaje (del tracker GPS) */
export function getPosicionActual(codigo) {
  const tracker = _distTracker.get(codigo);
  if (!tracker) return null;
  return { lat: tracker.lastLat, lng: tracker.lastLng, kmRecorridos: tracker.totalKm };
}

/**
 * Km recorridos por un equipo en su viaje libre actualmente en curso.
 * Prioridad: odómetro del camión (más exacto). Si no hay odómetro válido
 * o el camión no lo expone, fallback al tracker GPS haversine acumulado.
 * @returns {number|null} km recorridos en el viaje en curso, o null si no hay viaje.
 */
export function getKmRecorridosEnCurso(codigo) {
  if (!codigo) return null;
  const viaje = _enCurso.get(codigo);
  if (!viaje) return null;

  // 1) Odómetro: el camión expone km del tablero
  if (viaje.odometroInicio != null) {
    const odoFin = getOdometro(codigo);
    if (odoFin != null) {
      let km = parseFloat(odoFin) - parseFloat(viaje.odometroInicio);
      if (Math.abs(km) > 100000) km = km / 1000;  // detectar metros
      if (km > 0 && km < 10000) return Math.round(km * 10) / 10;
    }
  }

  // 2) Fallback: tracker GPS haversine acumulado
  const tracker = _distTracker.get(codigo);
  if (tracker && tracker.totalKm > 0.05) {
    return Math.round(tracker.totalKm * 10) / 10;
  }

  return null;
}

// ── Getters ───────────────────────────────────────────────────────────────────

export function getViajesEnCurso() {
  return [..._enCurso.values()].map(v => {
    // Inyectar km acumulados por el tracker GPS en vivo.
    // Sin esto, v.kmRecorridos queda null mientras el viaje está abierto
    // (solo se escribe al cerrar el libre) y el cálculo de progreso de
    // viajes programados queda clavado en 5% aunque el equipo se mueva.
    // Nota: si el servidor se reinicia a mitad del viaje, el tracker arranca
    // desde 0 y va acumulando desde la siguiente posición.
    const clave = v.codigoEquipo || v.codigo || v.patente;
    const tracker = _distTracker.get(clave);
    const kmTracker = tracker && tracker.totalKm > 0.1
      ? Math.round(tracker.totalKm * 10) / 10
      : null;
    return {
      ...v,
      kmRecorridos: kmTracker ?? v.kmRecorridos,
      pendienteConfirmacion: _pendiente.get(v.codigo || v.patente)?.geocerca.nombre ?? null,
    };
  });
}

export function getViajesCompletados({ division, subgrupo, codigo, patente, fecha } = {}) {
  let lista = [..._historial];
  if (division) lista = lista.filter(v => v.division === division);
  if (subgrupo) lista = lista.filter(v => v.subgrupo === subgrupo);
  if (codigo)   lista = lista.filter(v => v.codigo   === codigo);
  if (patente)  lista = lista.filter(v => v.patente  === patente);
  if (fecha)    lista = lista.filter(v => v.timestampInicio?.startsWith(fecha));
  return lista.sort((a, b) => b.id - a.id);
}

export function getResumenHoy() {
  return {
    completados: _historial.length,
    enCurso:     _enCurso.size,
    pendientes:  _pendiente.size,
    total:       _historial.length + _enCurso.size,
    kmTotal:     _historial.reduce((s, v) => s + (v.kmRecorridos || 0), 0),
  };
}

export async function getViajesDB({
  patente, codigo, codigoEquipo, division, subgrupo, desde, hasta,
  page = 1, pageSize = 50
} = {}) {
  const pool = db();
  if (!pool) return { data: getViajesCompletados(), total: _historial.length, source: 'memory' };

  const where  = ["estado = 'completado'"];
  const params = [];

  // Filtrar por codigo o patente
  const codigoFiltro = codigo || codigoEquipo;
  if (codigoFiltro) { where.push('codigo_equipo = ?'); params.push(codigoFiltro); }
  else if (patente) { where.push('patente = ?');        params.push(patente); }

  if (division) { where.push('division = ?');                params.push(division); }
  if (subgrupo) { where.push('subgrupo = ?');                params.push(subgrupo); }
  if (desde)    { where.push('DATE(timestamp_inicio) >= ?'); params.push(desde); }
  if (hasta)    { where.push('DATE(timestamp_inicio) <= ?'); params.push(hasta); }

  const whereStr = 'WHERE ' + where.join(' AND ');
  const offset   = (page - 1) * pageSize;

  try {
    const [[{ total }]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM fleetops_viajes_libres ${whereStr}`, params
    );
    const [rows] = await pool.execute(
      `SELECT * FROM fleetops_viajes_libres ${whereStr}
       ORDER BY timestamp_inicio DESC LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}`,
      params
    );
    return { data: rows.map(dbRowToViaje), total: parseInt(total), page, pageSize, source: 'mysql' };
  } catch (err) {
    log('error', `getViajesDB: ${err.message}`);
    return { data: [], total: 0, error: err.message };
  }
}

// ── Informes de rendimiento ─────────────────────────────────────────────────

/**
 * Informe agrupado por vehiculo — estadísticas de rendimiento.
 */
export async function getInformeVehiculos({ desde, hasta, division, empresa } = {}) {
  const pool = db();
  if (!pool) return { data: [], error: 'Sin conexion MySQL' };

  const where  = ["v.estado = 'completado'"];
  const params = [];

  if (desde)    { where.push('DATE(v.timestamp_inicio) >= ?'); params.push(desde); }
  if (hasta)    { where.push('DATE(v.timestamp_inicio) <= ?'); params.push(hasta); }
  if (division) { where.push('v.division = ?');                params.push(division); }
  if (empresa) {
    const codigosEmpresa = getVehiculos(empresa).map(v => v.codigo).filter(Boolean);
    if (codigosEmpresa.length > 0) {
      where.push(`v.codigo_equipo IN (${codigosEmpresa.map(() => '?').join(',')})`);
      params.push(...codigosEmpresa);
    } else {
      // Empresa sin vehiculos → resultado vacio
      return { data: [] };
    }
  }

  const whereStr = 'WHERE ' + where.join(' AND ');

  try {
    const [rows] = await pool.execute(
      `SELECT
         v.codigo_equipo AS codigo,
         v.patente,
         v.division,
         v.subgrupo,
         COUNT(*) AS totalViajes,
         SUM(CASE WHEN v.km_recorridos IS NOT NULL THEN v.km_recorridos ELSE 0 END) AS totalKm,
         AVG(CASE WHEN v.km_recorridos IS NOT NULL AND v.km_recorridos > 0 THEN v.km_recorridos ELSE NULL END) AS promedioKm,
         SUM(CASE WHEN v.duracion_min IS NOT NULL THEN v.duracion_min ELSE 0 END) AS totalMinutos,
         AVG(CASE WHEN v.duracion_min IS NOT NULL AND v.duracion_min > 0 THEN v.duracion_min ELSE NULL END) AS promedioDuracion,
         COUNT(DISTINCT DATE(v.timestamp_inicio)) AS diasActivo,
         MIN(DATE(v.timestamp_inicio)) AS primerViaje,
         MAX(DATE(v.timestamp_inicio)) AS ultimoViaje,
         COUNT(DISTINCT v.chofer) AS choferesDistintos,
         GROUP_CONCAT(DISTINCT v.chofer ORDER BY v.chofer SEPARATOR ', ') AS choferes
       FROM fleetops_viajes_libres v
       ${whereStr}
       GROUP BY v.codigo_equipo, v.patente, v.division, v.subgrupo
       ORDER BY totalViajes DESC`,
      params
    );

    return {
      data: rows.map(r => ({
        codigo:             r.codigo,
        patente:            r.patente,
        division:           r.division,
        subgrupo:           r.subgrupo,
        totalViajes:        r.totalViajes,
        totalKm:            r.totalKm ? Math.round(parseFloat(r.totalKm) * 10) / 10 : 0,
        promedioKm:         r.promedioKm ? Math.round(parseFloat(r.promedioKm) * 10) / 10 : 0,
        totalMinutos:       r.totalMinutos ? parseInt(r.totalMinutos) : 0,
        promedioDuracion:   r.promedioDuracion ? Math.round(parseFloat(r.promedioDuracion)) : 0,
        diasActivo:         r.diasActivo,
        primerViaje:        r.primerViaje,
        ultimoViaje:        r.ultimoViaje,
        choferesDistintos:  r.choferesDistintos,
        choferes:           r.choferes || '',
        viajesPorDia:       r.diasActivo > 0 ? Math.round((r.totalViajes / r.diasActivo) * 10) / 10 : 0,
        kmPorDia:           r.diasActivo > 0 ? Math.round((parseFloat(r.totalKm || 0) / r.diasActivo) * 10) / 10 : 0,
      })),
    };
  } catch (err) {
    log('error', `getInformeVehiculos: ${err.message}`);
    return { data: [], error: err.message };
  }
}

/**
 * Informe agrupado por chofer — estadísticas de rendimiento.
 */
export async function getInformeChoferes({ desde, hasta, division, empresa } = {}) {
  const pool = db();
  if (!pool) return { data: [], error: 'Sin conexion MySQL' };

  const where  = ["v.estado = 'completado'", "v.chofer IS NOT NULL", "v.chofer != ''"];
  const params = [];

  if (desde)    { where.push('DATE(v.timestamp_inicio) >= ?'); params.push(desde); }
  if (hasta)    { where.push('DATE(v.timestamp_inicio) <= ?'); params.push(hasta); }
  if (division) { where.push('v.division = ?');                params.push(division); }
  if (empresa) {
    const codigosEmpresa = getVehiculos(empresa).map(v => v.codigo).filter(Boolean);
    if (codigosEmpresa.length > 0) {
      where.push(`v.codigo_equipo IN (${codigosEmpresa.map(() => '?').join(',')})`);
      params.push(...codigosEmpresa);
    } else {
      return { data: [] };
    }
  }

  const whereStr = 'WHERE ' + where.join(' AND ');

  try {
    const [rows] = await pool.execute(
      `SELECT
         v.chofer,
         COUNT(*) AS totalViajes,
         SUM(CASE WHEN v.km_recorridos IS NOT NULL THEN v.km_recorridos ELSE 0 END) AS totalKm,
         AVG(CASE WHEN v.km_recorridos IS NOT NULL AND v.km_recorridos > 0 THEN v.km_recorridos ELSE NULL END) AS promedioKm,
         SUM(CASE WHEN v.duracion_min IS NOT NULL THEN v.duracion_min ELSE 0 END) AS totalMinutos,
         AVG(CASE WHEN v.duracion_min IS NOT NULL AND v.duracion_min > 0 THEN v.duracion_min ELSE NULL END) AS promedioDuracion,
         COUNT(DISTINCT DATE(v.timestamp_inicio)) AS diasActivo,
         MIN(DATE(v.timestamp_inicio)) AS primerViaje,
         MAX(DATE(v.timestamp_inicio)) AS ultimoViaje,
         COUNT(DISTINCT v.codigo_equipo) AS vehiculosDistintos,
         GROUP_CONCAT(DISTINCT v.codigo_equipo ORDER BY v.codigo_equipo SEPARATOR ', ') AS vehiculos,
         GROUP_CONCAT(DISTINCT v.division ORDER BY v.division SEPARATOR ', ') AS divisiones
       FROM fleetops_viajes_libres v
       ${whereStr}
       GROUP BY v.chofer
       ORDER BY totalViajes DESC`,
      params
    );

    return {
      data: rows.map(r => ({
        chofer:              r.chofer,
        totalViajes:         r.totalViajes,
        totalKm:             r.totalKm ? Math.round(parseFloat(r.totalKm) * 10) / 10 : 0,
        promedioKm:          r.promedioKm ? Math.round(parseFloat(r.promedioKm) * 10) / 10 : 0,
        totalMinutos:        r.totalMinutos ? parseInt(r.totalMinutos) : 0,
        promedioDuracion:    r.promedioDuracion ? Math.round(parseFloat(r.promedioDuracion)) : 0,
        diasActivo:          r.diasActivo,
        primerViaje:         r.primerViaje,
        ultimoViaje:         r.ultimoViaje,
        vehiculosDistintos:  r.vehiculosDistintos,
        vehiculos:           r.vehiculos || '',
        divisiones:          r.divisiones || '',
        viajesPorDia:        r.diasActivo > 0 ? Math.round((r.totalViajes / r.diasActivo) * 10) / 10 : 0,
        kmPorDia:            r.diasActivo > 0 ? Math.round((parseFloat(r.totalKm || 0) / r.diasActivo) * 10) / 10 : 0,
      })),
    };
  } catch (err) {
    log('error', `getInformeChoferes: ${err.message}`);
    return { data: [], error: err.message };
  }
}

/**
 * Informe extendido / liquidación — viajes individuales con tarifa por ruta.
 * Agrupado por chofer, muestra cada viaje con origen, destino, precio.
 */
export async function getLiquidacion({ desde, hasta, division, chofer, empresa } = {}) {
  const pool = db();
  if (!pool) return { data: [], error: 'Sin conexion MySQL' };

  const where  = ["v.estado = 'completado'"];
  const params = [];

  if (desde)    { where.push('DATE(v.timestamp_inicio) >= ?'); params.push(desde); }
  if (hasta)    { where.push('DATE(v.timestamp_inicio) <= ?'); params.push(hasta); }
  if (division) { where.push('v.division = ?');                params.push(division); }
  if (chofer)   { where.push('v.chofer = ?');                  params.push(chofer); }
  if (empresa) {
    const codigosEmpresa = getVehiculos(empresa).map(v => v.codigo).filter(Boolean);
    if (codigosEmpresa.length > 0) {
      where.push(`v.codigo_equipo IN (${codigosEmpresa.map(() => '?').join(',')})`);
      params.push(...codigosEmpresa);
    } else {
      return { data: [], totalViajes: 0, totalKm: 0, totalPrecio: 0, viajesSinTarifa: 0 };
    }
  }

  const whereStr = 'WHERE ' + where.join(' AND ');

  try {
    const [rows] = await pool.execute(
      `SELECT
         v.id_viaje_libre AS id,
         v.codigo_equipo,
         v.patente,
         v.chofer,
         v.division,
         v.subgrupo,
         v.nombre_geocerca_origen AS origen,
         v.nombre_geocerca_destino AS destino,
         v.timestamp_inicio,
         v.timestamp_fin,
         v.duracion_min,
         v.km_recorridos
       FROM fleetops_viajes_libres v
       ${whereStr}
       ORDER BY v.chofer ASC, v.timestamp_inicio ASC`,
      params
    );

    // Agregar tarifa a cada viaje
    const viajes = rows.map(r => {
      const tarifa = buscarTarifa(r.origen, r.destino);
      return {
        id:             r.id,
        codigoEquipo:   r.codigo_equipo,
        patente:        r.patente,
        chofer:         r.chofer || null,
        division:       r.division,
        subgrupo:       r.subgrupo,
        origen:         r.origen || '—',
        destino:        r.destino || '—',
        timestampInicio: r.timestamp_inicio?.toISOString?.() ?? r.timestamp_inicio,
        timestampFin:    r.timestamp_fin?.toISOString?.() ?? r.timestamp_fin,
        duracionMin:    r.duracion_min,
        kmRecorridos:   r.km_recorridos ? parseFloat(r.km_recorridos) : null,
        precio:         tarifa?.precio ?? null,
        tarifaMatch:    tarifa ? `${tarifa.origen} → ${tarifa.destino}` : null,
      };
    });

    // Agrupar por chofer para resumen
    const porChofer = {};
    for (const v of viajes) {
      const key = v.chofer || '(Sin chofer)';
      if (!porChofer[key]) {
        porChofer[key] = { chofer: key, viajes: [], totalViajes: 0, totalKm: 0, totalPrecio: 0 };
      }
      porChofer[key].viajes.push(v);
      porChofer[key].totalViajes++;
      porChofer[key].totalKm += v.kmRecorridos || 0;
      porChofer[key].totalPrecio += v.precio || 0;
    }

    const agrupado = Object.values(porChofer).sort((a, b) => b.totalViajes - a.totalViajes);

    return {
      data: agrupado,
      totalViajes: viajes.length,
      totalKm:     Math.round(viajes.reduce((s, v) => s + (v.kmRecorridos || 0), 0) * 10) / 10,
      totalPrecio: viajes.reduce((s, v) => s + (v.precio || 0), 0),
      viajesSinTarifa: viajes.filter(v => v.precio === null).length,
    };
  } catch (err) {
    log('error', `getLiquidacion: ${err.message}`);
    return { data: [], error: err.message };
  }
}
