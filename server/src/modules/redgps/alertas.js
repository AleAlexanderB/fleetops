/**
 * alertas.js
 * Polling getAlerts — fuente de verdad para viajes libres.
 * v9: Multi-empresa — poll getAlerts de todas las cuentas RedGPS.
 *
 * getAlerts.Equipo = codigo interno (ej: "A021") → resolver con getVehiculoPorCodigo()
 */

import { getEmpresas }          from '../../core/empresas.js';
import { withSyncLog }          from '../../database/sync-log.js';
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

async function _pollAlertas() {
  const hoy = fechaHoyAR();
  const empresas = getEmpresas();

  if (_fechaActual !== hoy) {
    _procesadas  = new Set();
    _fechaActual = hoy;
    log('info', `Nuevo dia: ${hoy} — deduplicacion reseteada`);
  }

  let totalNuevas = 0, totalIgnoradas = 0;

  for (const empresa of empresas) {
    try {
      log('info', `[${empresa.nombre}] Consultando alertas del dia ${hoy}...`);
      // service24gps espera startDate/endDate en formato "YYYY-MM-DD HH:MM:SS"
      const data = await empresa.client.post('/getAlerts', {
        startDate: `${hoy} 00:00:00`,
        endDate:   `${hoy} 23:59:59`,
      });

      if (!Array.isArray(data)) {
        log('warn', `[${empresa.nombre}] getAlerts no devolvio un array`);
        continue;
      }

      log('info', `[${empresa.nombre}] Alertas recibidas: ${data.length}`);

      const ordenadas = [...data].sort((a, b) =>
        `${a.Fecha} ${a.Hora}`.localeCompare(`${b.Fecha} ${b.Hora}`)
      );

      let nuevas = 0, ignoradas = 0;

      for (const alerta of ordenadas) {
        const { tipo, geocerca: nombreGeocerca } = parsearDescripcion(alerta.Descripcion);
        if (!tipo || !nombreGeocerca) { ignoradas++; continue; }

        const clave = `${alerta.Equipo}|${alerta.Fecha}|${alerta.Hora}|${tipo}|${nombreGeocerca}`;
        if (_procesadas.has(clave)) { ignoradas++; continue; }

        const geocerca = buscarGeocercaPorNombre(nombreGeocerca);
        if (!geocerca) {
          log('warn', `[${empresa.nombre}] Geocerca no encontrada: "${nombreGeocerca}" (equipo: ${alerta.Equipo})`);
          ignoradas++;
          continue;
        }

        const vehiculo = getVehiculoPorCodigo(alerta.Equipo)
                      || getVehiculoPorNombre(alerta.Equipo)
                      || getVehiculoPorPatente(alerta.Equipo)
                      || {
                          codigo:       alerta.Equipo,
                          patente:      null,
                          etiqueta:     alerta.Equipo,
                          codigoEquipo: alerta.Equipo,
                          empresa:      empresa.nombre,
                          chofer:       null,
                          division:     null,
                          subgrupo:     null,
                          conductor:    alerta.Conductor || null,
                        };

        if (alerta.Conductor && !vehiculo.chofer) {
          vehiculo.conductor = alerta.Conductor;
        }

        await procesarAlertaRedGPS({
          vehiculo,
          tipo,
          geocerca,
          timestamp: `${alerta.Fecha}T${alerta.Hora}`,
          latitud:   parseFloat(alerta.Latitud)  || null,
          longitud:  parseFloat(alerta.Longitud) || null,
        });

        _procesadas.add(clave);
        nuevas++;
      }

      totalNuevas    += nuevas;
      totalIgnoradas += ignoradas;
      log('info', `[${empresa.nombre}] Ciclo: nuevas=${nuevas} | ignoradas=${ignoradas}`);
    } catch (err) {
      log('error', `[${empresa.nombre}] Error en getAlerts: ${err.message}`);
    }
  }

  log('info', `Total alertas: nuevas=${totalNuevas} | ignoradas=${totalIgnoradas} | dedup=${_procesadas.size}`);
  return { procesadas: totalNuevas, ignoradas: totalIgnoradas, nuevas: totalNuevas };
}

/** Sembrar claves ya procesadas (para evitar duplicados post-restart) */
export function seedProcesadas(claves) {
  for (const c of claves) _procesadas.add(c);
  if (claves.length) log('info', `Sembradas ${claves.length} claves de deduplicacion desde DB`);
}

export async function pollAlertas() {
  return withSyncLog('getAlerts', _pollAlertas);
}
