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

import { getEmpresas } from '../../core/empresas.js';
import {
  actualizarEstadoVehiculo,
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

export async function pollPosiciones() {
  const empresas = getEmpresas();
  const actualizaciones = [];
  let dentroDeGeocerca  = 0;

  // Construir mapa temporal de equiposDentro — se asigna atomicamente al final
  const equiposDentroTemp = new Map();  // idCerca → Set<codigo>

  for (const empresa of empresas) {
    try {
      const data = await empresa.client.post('/getdata', { sensores: 0, UseUTCDate: 0 });

      if (!Array.isArray(data)) {
        log('warn', `[${empresa.nombre}] getdata no devolvio un array`);
        continue;
      }

      for (const item of data) {
        const unitPlate = item.UnitPlate  || null;
        const idgps     = item.GpsIdentif || null;

        actualizarEstadoVehiculo(unitPlate, item);

        const vehiculo = (idgps ? getVehiculoPorIdGps(idgps) : null)
                      || (unitPlate ? getVehiculoPorPatente(unitPlate) : null);

        if (!vehiculo && (idgps || unitPlate)) {
          // Log solo una vez por ciclo, para la primera unidad no resuelta
          if (!_loggedUnresolved.has(idgps || unitPlate)) {
            log('warn', `[${empresa.nombre}] Vehiculo no resuelto: idgps=${idgps} plate=${unitPlate}`);
            _loggedUnresolved.add(idgps || unitPlate);
          }
        }

        const lat = parseFloat(item.Latitude);
        const lng = parseFloat(item.Longitude);
        const geocercaActual = getGeoercaPorUbicacion(lat, lng);

        actualizarGeocercaVehiculo(unitPlate, idgps, geocercaActual?.nombre || null);

        if (geocercaActual) {
          dentroDeGeocerca++;
          const codigo = vehiculo?.codigo ?? unitPlate ?? idgps;
          if (codigo) {
            if (!equiposDentroTemp.has(geocercaActual.idCerca)) {
              equiposDentroTemp.set(geocercaActual.idCerca, new Set());
            }
            equiposDentroTemp.get(geocercaActual.idCerca).add(codigo);
          }
        }

        // Acumular distancia GPS para viajes en curso
        if (vehiculo?.codigo) {
          actualizarPosicionViaje(vehiculo.codigo, lat, lng);
        }

        // Deteccion de geocercas temporales (viajes programados con punto custom)
        const geocercaTemp = verificarPosicionEnTemp(lat, lng);
        if (geocercaTemp && vehiculo?.codigo) {
          log('info', `[GeoTemp] ${vehiculo.etiqueta || vehiculo.codigo} dentro de geocerca temp "${geocercaTemp.nombre}" (viaje #${geocercaTemp.viajeProgramadoId}, tipo=${geocercaTemp.tipo})`);
        }

        // Deteccion de alertas operativas (velocidad, ralenti)
        const vel = parseFloat(item.GpsSpeed) || 0;
        if (vehiculo) {
          _detectarAlertas(
            vehiculo, vel, item.Ignition, lat, lng,
            geocercaActual?.nombre || null,
            item.Conductor || null,
            item.ReportDate || null
          ).catch(err => log('error', `Error en deteccion de alertas: ${err.message}`));
        }

        // Deteccion de viajes por cambio de geocerca
        if (vehiculo) {
          const clave = vehiculo.codigo;
          const anterior = _geocercaAnterior.get(clave) || null;
          const actual   = geocercaActual ? { idCerca: geocercaActual.idCerca, nombre: geocercaActual.nombre } : null;
          const ts       = item.ReportDate || new Date().toISOString();

          if (anterior && !actual) {
            procesarAlertaRedGPS({ vehiculo, tipo: 'sale', geocerca: anterior, timestamp: ts }).catch(() => {});
          } else if (!anterior && actual) {
            procesarAlertaRedGPS({ vehiculo, tipo: 'ingresa', geocerca: actual, timestamp: ts }).catch(() => {});
          } else if (anterior && actual && anterior.idCerca !== actual.idCerca) {
            procesarAlertaRedGPS({ vehiculo, tipo: 'sale', geocerca: anterior, timestamp: ts }).catch(() => {});
            procesarAlertaRedGPS({ vehiculo, tipo: 'ingresa', geocerca: actual, timestamp: ts }).catch(() => {});
          }

          _geocercaAnterior.set(clave, actual);
        }

        actualizaciones.push({
          unitPlate,
          idgps,
          codigo:    vehiculo?.codigo    ?? null,
          etiqueta:  vehiculo?.etiqueta  ?? unitPlate ?? idgps ?? null,
          empresa:   vehiculo?.empresa   ?? empresa.nombre,
          latitud:   lat,
          longitud:  lng,
          velocidad: parseFloat(item.GpsSpeed) || 0,
          ignicion:  item.Ignition,
          direccion: item.Direction,
          conductor: item.Conductor,
          geocerca:  geocercaActual?.nombre || null,
          timestamp: item.ReportDate,
        });
      }

      log('info', `[${empresa.nombre}] getdata: ${data.length} unidades`);
    } catch (err) {
      log('error', `[${empresa.nombre}] Error en getdata: ${err.message}`);
    }
  }

  // Solo actualizar equiposDentro si obtuvimos datos (no pisar con vacio si hubo timeout)
  if (actualizaciones.length > 0) {
    actualizarTodosEquiposDentro(equiposDentroTemp);
  }

  if (_sseClients.size > 0) {
    const payload = JSON.stringify({ type: 'posiciones', data: actualizaciones });
    for (const res of _sseClients) {
      try { res.write(`data: ${payload}\n\n`); }
      catch (_) { _sseClients.delete(res); }
    }
  }

  const ralentiActivos = _ralentiState.size;
  log('info', `Total getdata: ${actualizaciones.length} unidades | en geocerca: ${dentroDeGeocerca} | ralenti_watch: ${ralentiActivos} | SSE: ${_sseClients.size}`);
  return actualizaciones;
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
