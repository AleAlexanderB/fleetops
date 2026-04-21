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
      // Formato de fecha para RedGPS: DD/MM/YYYY HH:MM:SS
      const [anio, mes, dia] = hoy.split('-');
      const data = await client.post('/getAlerts', {
        fechaini: `${dia}/${mes}/${anio} 00:00:00`,
        fechafin: `${dia}/${mes}/${anio} 23:59:59`,
      });
      const lista = Array.isArray(data) ? data : (data?.alerts || data?.data || []);

      for (const a of lista) {
        const id = String(a.idalert ?? a.IdAlert ?? `${a.Equipo}-${a.Fecha}-${a.Hora}-${a.Descripcion?.slice(0,20)}`);
        if (_procesadas.has(id)) continue;
        _procesadas.add(id);

        const veh = resolverVehiculo(String(a.idgps ?? a.Equipo ?? ''), a.plate ?? '');

        const alerta = {
          id,
          empresa: nombre,
          // Campos originales RedGPS — preservados para que FleetOPS pueda procesarlos
          Equipo:      a.Equipo      || '',
          Descripcion: a.Descripcion || '',
          Fecha:       a.Fecha       || '',
          Hora:        a.Hora        || '',
          Latitud:     a.Latitud     || null,
          Longitud:    a.Longitud    || null,
          Conductor:   a.Conductor   || null,
          // Campos normalizados para otros consumidores
          codigo:      a.Equipo      || '',
          descripcion: a.Descripcion || '',
          fecha:       a.Fecha       || '',
          hora:        a.Hora        || '',
          lat:         parseFloat(a.Latitud  ?? 0) || null,
          lng:         parseFloat(a.Longitud ?? 0) || null,
          conductor:   a.Conductor || null,
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
