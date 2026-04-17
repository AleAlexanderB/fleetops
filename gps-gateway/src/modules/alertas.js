/**
 * alertas.js
 * Polling de alertas de RedGPS. Dedup por id de alerta.
 */
import { getEmpresas } from '../core/empresas.js';
import { broadcast }   from '../sse/broadcaster.js';
import { resolverVehiculo } from './vehiculos.js';

const _procesadas = new Set(); // ids ya emitidas

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Alertas] ${msg}`);
}

function fechaHoy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

export async function pollAlertas() {
  const empresas = getEmpresas();
  const hoy = fechaHoy();
  let nuevas = 0;

  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/getAlerts', {
        startdate: `${hoy} 00:00:00`,
        enddate:   `${hoy} 23:59:59`,
      });
      const lista = Array.isArray(data) ? data : (data?.alerts || data?.data || []);

      for (const a of lista) {
        const id = String(a.idalert ?? a.id ?? `${a.idgps}-${a.date}-${a.type}`);
        if (_procesadas.has(id)) continue;
        _procesadas.add(id);

        const veh = resolverVehiculo(String(a.idgps ?? ''), a.plate ?? '');

        const alerta = {
          id,
          empresa: nombre,
          idgps:   String(a.idgps ?? ''),
          codigo:  veh?.codigo || a.name || '',
          patente: a.plate || veh?.patente || '',
          etiqueta: veh?.etiqueta || a.name || String(a.idgps ?? ''),
          tipoAlerta: a.type || a.alertType || '',
          descripcion: a.description || a.desc || '',
          lat:    parseFloat(a.lat ?? a.latitude  ?? 0),
          lng:    parseFloat(a.lng ?? a.longitude ?? 0),
          fecha:  a.date || a.datetime || '',
        };

        broadcast('alert', { alerta });
        nuevas++;
      }
    } catch (err) {
      if (err.redgpsCode === 30300) {
        log('warn', `[${nombre}] getAlerts retornó 30300 (bad request) — saltando`);
      } else {
        log('error', `[${nombre}] Error en pollAlertas: ${err.message}`);
      }
    }
  }

  // Reset dedup a medianoche
  const ahora = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  if (ahora !== hoy) _procesadas.clear();

  log('info', `Alertas: nuevas=${nuevas}`);
  return { nuevas };
}
