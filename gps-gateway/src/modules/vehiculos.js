/**
 * vehiculos.js
 * Sincroniza y cachea la lista de vehículos de todas las empresas.
 *
 * Campos reales de RedGPS (/vehicleGetAll):
 *   v.id, v.idgps, v.nombre ("B012 Descripcion"), v.patente
 * El código interno es la PRIMERA PALABRA de v.nombre (ej: "B012")
 */
import { getEmpresas } from '../core/empresas.js';

// Índices en memoria
const _vehiculos  = new Map();  // codigo → vehiculo
const _porPatente = new Map();  // patente uppercase → vehiculo
const _porIdGps   = new Map();  // idgps → vehiculo

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Vehiculos] ${msg}`);
}

/** El código interno es la primera palabra de v.nombre (ej: "B012 Ford Ranger" → "B012") */
function extraerCodigo(nombre) {
  if (!nombre) return null;
  return nombre.trim().split(/\s+/)[0].toUpperCase();
}

function normalizar(v, empresa) {
  const codigo  = extraerCodigo(v.nombre);
  const patente = v.patente?.trim() || null;
  return {
    empresa,
    codigo,
    id:       v.id    ? String(v.id)    : null,
    idgps:    v.idgps ? String(v.idgps) : null,
    nombre:   v.nombre || '',
    patente,
    etiqueta: patente || codigo || String(v.id ?? ''),
    conductor: null,   // se rellena con /driverGetAll
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
        if (!veh.codigo) continue;
        _vehiculos.set(veh.codigo, veh);
        if (veh.idgps)   _porIdGps.set(veh.idgps, veh);
        if (veh.patente) _porPatente.set(veh.patente.toUpperCase(), veh);
        if (!veh.patente) sinPatente++;
      }
      total += lista.length;
      log('info', `[${nombre}] ${lista.length} vehiculos sincronizados`);
    } catch (err) {
      log('error', `[${nombre}] Error al sincronizar vehiculos: ${err.message}`);
    }
  }

  // Conductores (opcional)
  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/driverGetAll');
      const lista = Array.isArray(data) ? data : (data?.drivers || data?.data || []);
      for (const d of lista) {
        // Asociar conductor a vehículo por id
        const vid = String(d.id_vehiculo ?? d.vehicleId ?? d.idgps ?? '');
        const veh = _porIdGps.get(vid);
        if (veh) veh.conductor = `${d.nombre ?? ''} ${d.apellido ?? ''}`.trim() || null;
      }
    } catch { /* opcional */ }
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
  return _porIdGps.get(String(idgps)) || null;
}

export function getVehiculoPorPatente(patente) {
  if (!patente) return null;
  return _porPatente.get(patente.toUpperCase().trim()) || null;
}

/** Resuelve vehículo por IMEI primero, luego patente como fallback */
export function resolverVehiculo(idgps, patente) {
  return getVehiculoPorIdGps(idgps) || getVehiculoPorPatente(patente) || null;
}
