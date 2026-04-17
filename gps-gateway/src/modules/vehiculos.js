/**
 * vehiculos.js
 * Sincroniza y cachea la lista de vehículos de todas las empresas.
 */
import { getEmpresas } from '../core/empresas.js';

// Map: idgps (string) → vehiculo enriquecido
const _vehiculos = new Map();

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Vehiculos] ${msg}`);
}

function normalizar(v, empresa) {
  return {
    empresa,
    idgps:    String(v.idgps ?? v.id ?? ''),
    codigo:   v.name        || v.nombre  || '',   // código interno (ej: B012)
    patente:  v.plate       || v.patente || '',
    etiqueta: v.name        || v.plate   || String(v.idgps ?? ''),
    modelo:   v.model       || '',
    tipo:     v.type        || '',
    conductor: v.driver     || '',
    activo:   v.active !== false,
    raw: v,
  };
}

export async function syncVehiculos() {
  const empresas = getEmpresas();
  let total = 0;
  let sinPatente = 0;

  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/vehicleGetAll');
      const lista = Array.isArray(data) ? data : (data?.vehicles || data?.data || []);

      for (const v of lista) {
        const veh = normalizar(v, nombre);
        if (veh.idgps) _vehiculos.set(veh.idgps, veh);
        if (!veh.patente) sinPatente++;
      }
      total += lista.length;
      log('info', `[${nombre}] ${lista.length} vehiculos sincronizados`);
    } catch (err) {
      log('error', `[${nombre}] Error al sincronizar vehiculos: ${err.message}`);
    }
  }

  // Also try /driverGetAll for conductor info and update
  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/driverGetAll');
      const lista = Array.isArray(data) ? data : (data?.drivers || data?.data || []);
      // attach drivers to vehicles by idgps if available
      for (const d of lista) {
        const idgps = String(d.idgps ?? d.vehicleId ?? '');
        if (idgps && _vehiculos.has(idgps)) {
          _vehiculos.get(idgps).conductor = d.name || d.nombre || '';
        }
      }
    } catch { /* optional */ }
  }

  log('info', `Total sincronizados: ${total} equipos (${sinPatente} sin patente) de ${empresas.length} empresa(s)`);
  return { total, sinPatente };
}

export function getVehiculos(empresaFiltro) {
  const lista = [..._vehiculos.values()];
  if (empresaFiltro) return lista.filter(v => v.empresa === empresaFiltro);
  return lista;
}

export function getVehiculoPorIdGps(idgps) {
  return _vehiculos.get(String(idgps)) || null;
}

export function getVehiculoPorPatente(patente) {
  if (!patente) return null;
  const p = patente.toUpperCase().trim();
  for (const v of _vehiculos.values()) {
    if (v.patente?.toUpperCase().trim() === p) return v;
  }
  return null;
}

export function resolverVehiculo(idgps, patente) {
  return getVehiculoPorIdGps(idgps) || getVehiculoPorPatente(patente) || null;
}
