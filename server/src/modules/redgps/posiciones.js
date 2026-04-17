/**
 * posiciones.js
 * Polling getdata cada 30s — posicion en tiempo real y SSE.
 * v9: Multi-empresa — poll getdata de todas las cuentas RedGPS.
 *
 * DETECCION DE ALERTAS OPERATIVAS:
 * Analiza los datos de posicion para detectar:
 * - Exceso de velocidad (> umbral configurable)
 * - Ralentí (motor encendido, velocidad 0, por mas de X minutos)
 */

import { gatewayEvents }                    from '../../gateway/gateway-client.js';
import {
  actualizarEstadoVehiculoGateway,
  actualizarGeocercaVehiculo,
  getVehiculoPorIdGps,
  getVehiculoPorPatente,
} from './vehiculos.js';
import { getGeoercaPorUbicacion, actualizarTodosEquiposDentro } from './geocercas.js';
import { procesarAlertaRedGPS, actualizarPosicionViaje } from '../viajes/libres.js';
import { guardarAlerta } from '../alertas/alertas.js';
import { verificarPosicionEnTemp } from '../geocercas/geocercasTemp.js';

const _sseClients = new Set();

// Geocerca anterior por equipo — para detectar entradas/salidas sin getAlerts
const _geocercaAnterior = new Map(); // codigo → { idCerca, nombre }

// Para no spamear logs de vehiculos no resueltos
const _loggedUnresolved = new Set();

// ── Deteccion de alertas operativas ─────────────────────────────────────────

// Umbrales configurables (se pueden pasar a .env despues)
const VELOCIDAD_MAX_KMH     = parseInt(process.env.ALERTA_VELOCIDAD_MAX || '100');      // km/h
const RALENTI_MINUTOS        = parseInt(process.env.ALERTA_RALENTI_MIN  || '10');        // minutos
const COOLDOWN_VELOCIDAD_MIN = parseInt(process.env.ALERTA_VELOCIDAD_COOLDOWN || '5');   // minutos entre alertas del mismo equipo
const COOLDOWN_RALENTI_MIN   = parseInt(process.env.ALERTA_RALENTI_COOLDOWN   || '30');  // minutos entre alertas de ralenti

// Estado de ralenti: codigo → { desde: Date, alertaGenerada: boolean }
const _ralentiState = new Map();

// Cooldown de alertas: "tipo|codigo" → timestamp ultima alerta
const _alertaCooldown = new Map();

// Ultimo timestamp reportado por equipo — para no generar alertas duplicadas con datos viejos
const _lastReportDate = new Map(); // codigo → timestamp string

function _enCooldown(tipo, codigo, cooldownMin) {
  const key = `${tipo}|${codigo}`;
  const last = _alertaCooldown.get(key);
  if (!last) return false;
  return (Date.now() - last) < cooldownMin * 60 * 1000;
}

function _marcarAlerta(tipo, codigo) {
  _alertaCooldown.set(`${tipo}|${codigo}`, Date.now());
}

/**
 * Analiza datos de un vehiculo y genera alertas si corresponde.
 */
async function _detectarAlertas(vehiculo, velocidad, ignicion, lat, lng, geocerca, conductor, timestamp) {
  if (!vehiculo?.codigo) return;

  const codigo   = vehiculo.codigo;
  const etiqueta = vehiculo.etiqueta || codigo;
  const ahora    = new Date();

  // Verificar que el reporte es nuevo (no repetir alertas de datos viejos)
  const lastReport = _lastReportDate.get(codigo);
  if (timestamp && lastReport === timestamp) return; // mismo reporte, no analizar
  if (timestamp) _lastReportDate.set(codigo, timestamp);

  // Verificar antigüedad del reporte GPS
  let reporteViejo = false;
  if (timestamp) {
    const reportAge = ahora - new Date(timestamp);
    if (reportAge > 3600000) reporteViejo = true; // dato de mas de 1 hora
  }

  // ── Exceso de velocidad (solo con datos frescos) ──
  if (!reporteViejo && velocidad > VELOCIDAD_MAX_KMH && !_enCooldown('velocidad', codigo, COOLDOWN_VELOCIDAD_MIN)) {
    try {
      await guardarAlerta({
        tipo:            'velocidad',
        codigoEquipo:    codigo,
        patente:         vehiculo.patente || null,
        etiqueta,
        empresa:         vehiculo.empresa || null,
        division:        vehiculo.division || null,
        descripcion:     `Exceso de velocidad: ${velocidad.toFixed(0)} km/h (límite: ${VELOCIDAD_MAX_KMH} km/h)`,
        geocerca:        geocerca || null,
        latitud:         lat || null,
        longitud:        lng || null,
        velocidad,
        conductor:       conductor || vehiculo.chofer || null,
        timestampAlerta: timestamp || ahora.toISOString(),
      });
      _marcarAlerta('velocidad', codigo);
      log('warn', `⚠ VELOCIDAD: ${etiqueta} a ${velocidad.toFixed(0)} km/h (max: ${VELOCIDAD_MAX_KMH})`);
    } catch (err) {
      log('error', `Error guardando alerta velocidad: ${err.message}`);
    }
  }

  // ── Ralentí (motor encendido, velocidad 0) ──
  // NOTA: No depende de la antigüedad del GPS. Muchos equipos reportan timestamps
  // viejos pero el vehículo realmente está ahí en ralentí. Trackeamos usando
  // Date.now() (cuando NOSOTROS vimos el estado) en vez del timestamp GPS.
  const motorEncendido = ignicion === 1 || ignicion === '1' || ignicion === true || ignicion === 'true';
  const parado         = velocidad < 2; // menos de 2 km/h = parado

  if (motorEncendido && parado) {
    const state = _ralentiState.get(codigo);
    if (!state) {
      // Empieza periodo de ralenti — usamos Date.now(), no el timestamp GPS
      _ralentiState.set(codigo, { desde: new Date(Date.now()), alertaGenerada: false });
    } else {
      const minutos = (Date.now() - state.desde.getTime()) / 60000;
      if (minutos >= RALENTI_MINUTOS && !state.alertaGenerada && !_enCooldown('ralenti', codigo, COOLDOWN_RALENTI_MIN)) {
        try {
          await guardarAlerta({
            tipo:            'ralenti',
            codigoEquipo:    codigo,
            patente:         vehiculo.patente || null,
            etiqueta,
            empresa:         vehiculo.empresa || null,
            division:        vehiculo.division || null,
            descripcion:     `Motor encendido sin movimiento por ${Math.round(minutos)} minutos`,
            geocerca:        geocerca || null,
            latitud:         lat || null,
            longitud:        lng || null,
            velocidad:       0,
            conductor:       conductor || vehiculo.chofer || null,
            timestampAlerta: state.desde.toISOString(),
          });
          state.alertaGenerada = true;
          _marcarAlerta('ralenti', codigo);
          log('warn', `⚠ RALENTÍ: ${etiqueta} motor encendido ${Math.round(minutos)} min sin moverse`);
        } catch (err) {
          log('error', `Error guardando alerta ralenti: ${err.message}`);
        }
      }
    }
  } else {
    // Se movio o apago motor → resetear ralenti
    _ralentiState.delete(codigo);
  }
}

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Posiciones] ${msg}`);
}

/**
 * Inicializa el procesamiento de posiciones desde el gateway SSE.
 * Llamar una vez al arranque — no polling, es event-driven.
 */
export function initPosicionesDesdeGateway() {
  // ── positions_update: procesar posiciones y actualizar estado ──────────────
  gatewayEvents.on('positions_update', async (event) => {
    const positions    = event.positions || [];
    const actualizaciones = [];
    let dentroDeGeocerca  = 0;
    const equiposDentroTemp = new Map();

    for (const pos of positions) {
      if (!pos.idgps && !pos.patente) continue;

      // Actualizar estado del vehículo con formato de gateway
      actualizarEstadoVehiculoGateway(pos);

      // Actualizar geocerca del vehículo
      actualizarGeocercaVehiculo(pos.patente, pos.idgps, pos.geocerca?.nombre || null);

      // Estadísticas de geocercas
      if (pos.geocerca) {
        dentroDeGeocerca++;
        const codigo = pos.codigo || pos.patente || pos.idgps;
        if (codigo && pos.geocerca.id) {
          if (!equiposDentroTemp.has(pos.geocerca.id)) {
            equiposDentroTemp.set(pos.geocerca.id, new Set());
          }
          equiposDentroTemp.get(pos.geocerca.id).add(codigo);
        }
      }

      // Acumular distancia GPS para viajes en curso
      if (pos.codigo) {
        actualizarPosicionViaje(pos.codigo, pos.lat, pos.lng);
      }

      // Verificar geocercas temporales
      const geocercaTemp = verificarPosicionEnTemp(pos.lat, pos.lng);
      if (geocercaTemp && pos.codigo) {
        log('info', `[GeoTemp] ${pos.etiqueta || pos.codigo} dentro de geocerca temp "${geocercaTemp.nombre}"`);
      }

      // Detección de alertas operativas (velocidad, ralentí)
      if (pos.codigo) {
        const vehiculo = {
          codigo: pos.codigo, patente: pos.patente, etiqueta: pos.etiqueta,
          empresa: pos.empresa, chofer: null, division: null,
        };
        _detectarAlertas(
          vehiculo, pos.velocidad || 0, pos.ignicion,
          pos.lat, pos.lng,
          pos.geocerca?.nombre || null,
          pos.conductor || null,
          pos.timestamp || null
        ).catch(err => log('error', `Error en deteccion de alertas: ${err.message}`));
      }

      actualizaciones.push({
        unitPlate:  pos.patente  || null,
        idgps:      pos.idgps    || null,
        codigo:     pos.codigo   || null,
        etiqueta:   pos.etiqueta || pos.patente || pos.idgps || null,
        empresa:    pos.empresa  || null,
        latitud:    pos.lat,
        longitud:   pos.lng,
        velocidad:  pos.velocidad || 0,
        ignicion:   pos.ignicion,
        direccion:  pos.rumbo    || null,
        conductor:  pos.conductor || null,
        geocerca:   pos.geocerca?.nombre || null,
        timestamp:  pos.timestamp || null,
      });
    }

    if (actualizaciones.length > 0) {
      actualizarTodosEquiposDentro(equiposDentroTemp);
    }

    // Push a clientes SSE del frontend FleetOPS
    if (_sseClients.size > 0) {
      const payload = JSON.stringify({ type: 'posiciones', data: actualizaciones });
      for (const res of _sseClients) {
        try { res.write(`data: ${payload}\n\n`); }
        catch (_) { _sseClients.delete(res); }
      }
    }

    log('info', `Total getdata: ${actualizaciones.length} unidades | en geocerca: ${dentroDeGeocerca} | ralenti_watch: ${_ralentiState.size} | SSE: ${_sseClients.size}`);
  });

  // ── geocerca_salida → procesar salida de geocerca ──────────────────────────
  gatewayEvents.on('geocerca_salida', async (event) => {
    const { equipo, geocerca } = event;
    if (!equipo || !geocerca) return;

    const vehiculo = {
      codigo:   equipo.codigo  || equipo.patente || equipo.idgps,
      patente:  equipo.patente || null,
      etiqueta: equipo.etiqueta || equipo.codigo || equipo.idgps,
      empresa:  equipo.empresa  || null,
      chofer:   null, division: null, subgrupo: null,
    };

    procesarAlertaRedGPS({
      vehiculo,
      tipo:    'sale',
      geocerca: { idCerca: geocerca.id, nombre: geocerca.nombre },
      timestamp: event.timestamp || new Date().toISOString(),
    }).catch(err => log('error', `Error procesando salida geocerca: ${err.message}`));
  });

  // ── geocerca_entrada → procesar entrada a geocerca ─────────────────────────
  gatewayEvents.on('geocerca_entrada', async (event) => {
    const { equipo, geocerca } = event;
    if (!equipo || !geocerca) return;

    const vehiculo = {
      codigo:   equipo.codigo  || equipo.patente || equipo.idgps,
      patente:  equipo.patente || null,
      etiqueta: equipo.etiqueta || equipo.codigo || equipo.idgps,
      empresa:  equipo.empresa  || null,
      chofer:   null, division: null, subgrupo: null,
    };

    procesarAlertaRedGPS({
      vehiculo,
      tipo:    'ingresa',
      geocerca: { idCerca: geocerca.id, nombre: geocerca.nombre },
      timestamp: event.timestamp || new Date().toISOString(),
    }).catch(err => log('error', `Error procesando entrada geocerca: ${err.message}`));
  });

  log('info', 'Procesamiento de posiciones vía gateway SSE iniciado');
}

/** @deprecated - use gateway SSE via initPosicionesDesdeGateway() */
export async function pollPosiciones() {
  log('warn', 'pollPosiciones() llamado pero ya no usa RedGPS directo — usar initPosicionesDesdeGateway()');
  return [];
}

export function registrarClienteSSE(req, res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  _sseClients.add(res);
  log('info', `Cliente SSE conectado. Total: ${_sseClients.size}`);
  req.on('close', () => {
    _sseClients.delete(res);
    log('info', `Cliente SSE desconectado. Total: ${_sseClients.size}`);
  });
}

export function getCantidadClientesSSE() { return _sseClients.size; }

/** Retorna configuracion actual de alertas operativas */
export function getAlertasConfig() {
  return {
    velocidadMaxKmh:     VELOCIDAD_MAX_KMH,
    ralentiMinutos:      RALENTI_MINUTOS,
    cooldownVelocidadMin: COOLDOWN_VELOCIDAD_MIN,
    cooldownRalentiMin:   COOLDOWN_RALENTI_MIN,
    equiposEnRalenti:     _ralentiState.size,
    alertasActivas:       _alertaCooldown.size,
  };
}
