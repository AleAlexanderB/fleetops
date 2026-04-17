/**
 * alertas.js
 * Polling getAlerts — fuente de verdad para viajes libres.
 * v9: Multi-empresa — poll getAlerts de todas las cuentas RedGPS.
 *
 * getAlerts.Equipo = codigo interno (ej: "A021") → resolver con getVehiculoPorCodigo()
 */

import { gatewayEvents }        from '../../gateway/gateway-client.js';
import { procesarAlertaRedGPS } from '../viajes/libres.js';
import {
  getVehiculoPorCodigo,
  getVehiculoPorNombre,
  getVehiculoPorPatente,
} from './vehiculos.js';
import { getGeocercas } from './geocercas.js';

// Set de claves procesadas hoy — formato: "EQUIPO|FECHA|HORA|TIPO"
let _procesadas  = new Set();
let _fechaActual = '';

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Alertas] ${msg}`);
}

function fechaHoyAR() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

function parsearDescripcion(descripcion) {
  if (!descripcion) return { tipo: null, geocerca: null };
  const desc  = descripcion.trim();
  const lower = desc.toLowerCase();

  let tipo = null;
  if (lower.includes('ingresa') || lower.includes('entra') || lower.includes('entrada')) {
    tipo = 'ingresa';
  } else if (lower.includes('sale') || lower.includes('salida') || lower.includes('salio')) {
    tipo = 'sale';
  }
  if (!tipo) return { tipo: null, geocerca: null };

  let geocerca = desc
    .replace(/ingresa\s*(a\s*)?/gi, '')
    .replace(/sale\s*(de\s*)?/gi,   '')
    .replace(/entrada\s*(a\s*)?/gi, '')
    .replace(/salida\s*(de\s*)?/gi, '')
    .replace(/salio\s*(de\s*)?/gi,  '')
    .trim();

  if (!geocerca || geocerca.replace(/[-\s]/g, '').length === 0) {
    return { tipo: null, geocerca: null };
  }
  return { tipo, geocerca };
}

function buscarGeocercaPorNombre(nombre) {
  if (!nombre) return null;
  const geocercas = getGeocercas();
  const norm = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const n = norm(nombre);

  const exacto = geocercas.find(g => norm(g.nombre) === n);
  if (exacto) return exacto;

  const prefSuf = geocercas.find(g => {
    const gn = norm(g.nombre);
    return gn.startsWith(n) || gn.endsWith(n) || n.startsWith(gn) || n.endsWith(gn);
  });
  if (prefSuf) return prefSuf;

  const subs = geocercas.filter(g => {
    const gn = norm(g.nombre);
    return gn.includes(n) || n.includes(gn);
  });
  if (subs.length === 1) return subs[0];

  return null;
}

/** Sembrar claves ya procesadas (para evitar duplicados post-restart) */
export function seedProcesadas(claves) {
  for (const c of claves) _procesadas.add(c);
  if (claves.length) log('info', `Sembradas ${claves.length} claves de deduplicacion desde DB`);
}

/**
 * Inicializa el procesamiento de alertas RedGPS desde el gateway SSE.
 * Llamar una vez al arranque.
 */
export function initAlertasDesdeGateway() {
  // Reset dedup al cambiar de día
  setInterval(() => {
    const hoy = fechaHoyAR();
    if (_fechaActual !== hoy) {
      _procesadas  = new Set();
      _fechaActual = hoy;
      log('info', `Nuevo día: ${hoy} — deduplicación reseteada`);
    }
  }, 60000); // check cada minuto

  gatewayEvents.on('alert', async (event) => {
    const a = event.alerta;
    if (!a) return;

    const hoy = fechaHoyAR();
    if (_fechaActual !== hoy) {
      _procesadas  = new Set();
      _fechaActual = hoy;
    }

    // El gateway preserva Descripcion, Equipo, Fecha, Hora del formato RedGPS
    // Parsear descripción para detectar tipo geocerca (ingresa/sale)
    const { tipo, geocerca: nombreGeocerca } = parsearDescripcion(a.descripcion || a.Descripcion || '');
    if (!tipo || !nombreGeocerca) return;

    const clave = `${a.codigo || a.Equipo}|${a.fecha || a.Fecha}|${a.hora || a.Hora}|${tipo}|${nombreGeocerca}`;
    if (_procesadas.has(clave)) return;

    const geocerca = buscarGeocercaPorNombre(nombreGeocerca);
    if (!geocerca) {
      log('warn', `Geocerca no encontrada desde gateway: "${nombreGeocerca}" (equipo: ${a.codigo || a.Equipo})`);
      return;
    }

    const codigoEquipo = a.codigo || a.Equipo || '';
    const vehiculo = getVehiculoPorCodigo(codigoEquipo)
                  || getVehiculoPorNombre(codigoEquipo)
                  || getVehiculoPorPatente(codigoEquipo)
                  || {
                      codigo:   codigoEquipo,
                      patente:  null,
                      etiqueta: codigoEquipo,
                      empresa:  a.empresa || null,
                      chofer:   null,
                      division: null,
                      subgrupo: null,
                      conductor: a.conductor || a.Conductor || null,
                    };

    await procesarAlertaRedGPS({
      vehiculo,
      tipo,
      geocerca,
      timestamp: a.fecha && a.hora ? `${a.fecha}T${a.hora}`
               : (a.Fecha && a.Hora ? `${a.Fecha}T${a.Hora}` : event.timestamp),
      latitud:  parseFloat(a.lat  ?? a.Latitud  ?? 0) || null,
      longitud: parseFloat(a.lng  ?? a.Longitud ?? 0) || null,
    });

    _procesadas.add(clave);
    log('info', `Alerta gateway procesada: ${codigoEquipo} ${tipo} ${nombreGeocerca}`);
  });

  log('info', 'Procesamiento de alertas vía gateway SSE iniciado');
}

/** @deprecated - usar initAlertasDesdeGateway() */
export async function pollAlertas() {
  log('warn', 'pollAlertas() llamado pero ya no usa RedGPS directo');
  return { procesadas: 0, ignoradas: 0, nuevas: 0 };
}
