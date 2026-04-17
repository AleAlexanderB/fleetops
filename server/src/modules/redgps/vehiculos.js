/**
 * vehiculos.js
 *
 * CLAVE PRINCIPAL: codigo_interno (primera palabra de v.nombre, ej: "A021", "K006")
 * v9: Soporte multi-empresa — cada vehiculo tiene campo `empresa` que indica
 *     de que cuenta RedGPS viene.
 *
 * INDICES EN MEMORIA:
 *   _vehiculos:  codigo → vehiculo  (Map principal, clave = codigo_interno)
 *   _porPatente: patente → vehiculo  (para resolver UnitPlate de getdata)
 *   _porIdGps:   idgps → vehiculo    (fallback por IMEI)
 */

import { getDivision } from '../divisiones/divisiones.js';
import { withSyncLog }  from '../../database/sync-log.js';
import { gatewayGet }   from '../../gateway/gateway-client.js';

let _vehiculos  = new Map();  // codigo → vehiculo
let _porPatente = new Map();  // patente → vehiculo  (secundario)
let _porIdGps   = new Map();  // idgps → vehiculo    (secundario)
let _enTaller   = new Map();  // codigo → boolean  (override manual)

function log(level, msg, data = {}) {
  console[level](`[${new Date().toISOString()}] [Vehiculos] ${msg}`,
    Object.keys(data).length ? data : '');
}

// ── Extraer codigo interno del nombre ────────────────────────────────────────

function extraerCodigo(nombre) {
  if (!nombre) return null;
  return nombre.trim().split(/\s+/)[0].toUpperCase();
}

// ── Sync desde gateway REST ──────────────────────────────────────────────────

async function _syncVehiculos() {
  const lista      = await gatewayGet('/api/vehicles');
  const nuevos     = new Map();
  const porPatente = new Map();
  const porIdGps   = new Map();

  for (const item of lista) {
    const codigo = item.codigo;
    if (!codigo) continue;

    const existente = _vehiculos.get(codigo);

    const vehiculo = {
      codigo:    item.codigo,
      id:        item.id,
      idgps:     item.idgps,
      nombre:    item.nombre,
      patente:   item.patente || null,
      etiqueta:  item.etiqueta,
      tienePatente: !!item.patente,
      empresa:   item.empresa,
      // Fields not in gateway — preserved from existing or set to null
      marca: null, modelo: null, anio: null, color: null,
      grupoRedGps: null, tipo: null,
      division:  getDivision(item.codigo)?.division || null,
      subgrupo:  getDivision(item.codigo)?.subgrupo || null,
      chofer:    item.conductor ? { nombre: item.conductor } : null,
      // Preserve dynamic state if vehicle already exists
      estado:              existente?.estado              || 'desconocido',
      velocidad:           existente?.velocidad           || 0,
      latitud:             existente?.latitud             || null,
      longitud:            existente?.longitud            || null,
      geocercaActual:      existente?.geocercaActual      || null,
      ultimaActualizacion: existente?.ultimaActualizacion || null,
      conductor:           existente?.conductor           || item.conductor || null,
    };

    nuevos.set(codigo, vehiculo);

    if (item.patente) {
      porPatente.set(item.patente.toUpperCase(), vehiculo);
    }

    if (item.idgps) {
      porIdGps.set(item.idgps, vehiculo);
    }
  }

  _vehiculos  = nuevos;
  _porPatente = porPatente;
  _porIdGps   = porIdGps;

  log('info', `[GatewaySync] ${lista.length} vehiculos sincronizados desde gateway`);
  return [..._vehiculos.values()];
}

// ── Actualizacion de estado (getdata) ────────────────────────────────────────

export function actualizarEstadoVehiculo(unitPlate, datosGps) {
  const v = (datosGps.GpsIdentif ? _porIdGps.get(datosGps.GpsIdentif) : null)
         || (unitPlate ? _porPatente.get(unitPlate.toUpperCase()) : null);

  if (!v) return;

  v.velocidad           = parseFloat(datosGps.GpsSpeed) || 0;
  v.ignicion            = datosGps.Ignition;
  v.latitud             = parseFloat(datosGps.Latitude)  || null;
  v.longitud            = parseFloat(datosGps.Longitude) || null;
  v.odometro            = datosGps.Odometer;
  v.ultimaActualizacion = datosGps.ReportDate;
  v.conductor           = datosGps.Conductor || v.chofer?.nombre || null;

  // Si el vehiculo esta marcado "en taller", no cambiar estado por GPS
  if (_enTaller.get(v.codigo)) {
    v.estado = 'en_taller';
  } else if (v.velocidad > 0) {
    v.estado = 'en_ruta';
  } else if (datosGps.Ignition === 1 || datosGps.Ignition === '1') {
    v.estado = 'detenido_encendido';
  } else {
    v.estado = 'inactivo';
  }
}

export function actualizarEstadoVehiculoGateway(pos) {
  const v = (pos.idgps ? _porIdGps.get(pos.idgps) : null)
         || (pos.patente ? _porPatente.get(pos.patente.toUpperCase()) : null);
  if (!v) return;

  v.velocidad           = parseFloat(pos.velocidad) || 0;
  v.ignicion            = pos.ignicion;
  v.latitud             = parseFloat(pos.lat) || null;
  v.longitud            = parseFloat(pos.lng) || null;
  v.ultimaActualizacion = pos.timestamp || null;
  v.conductor           = pos.conductor || v.chofer?.nombre || null;

  if (_enTaller.get(v.codigo)) {
    v.estado = 'en_taller';
  } else if (v.velocidad > 0) {
    v.estado = 'en_ruta';
  } else if (pos.ignicion === 1 || pos.ignicion === '1' || pos.ignicion === true) {
    v.estado = 'detenido_encendido';
  } else {
    v.estado = 'inactivo';
  }
}

export function actualizarGeocercaVehiculo(unitPlate, idgps, nombreGeocerca) {
  const v = (idgps ? _porIdGps.get(idgps) : null)
         || (unitPlate ? _porPatente.get(unitPlate.toUpperCase()) : null);
  if (v) v.geocercaActual = nombreGeocerca || null;
}

export function marcarAlerta(codigo) {
  const v = _vehiculos.get(codigo?.toUpperCase());
  if (v) v.estado = 'alerta';
}

// ── En taller (override manual) ──────────────────────────────────────────────

export function setEnTaller(codigo, enTaller) {
  if (!codigo) return;
  const key = codigo.toUpperCase();
  const v = _vehiculos.get(key);
  if (!v) return;
  if (enTaller) {
    _enTaller.set(key, true);
    v.estado = 'en_taller';
  } else {
    _enTaller.delete(key);
    // Resetear a desconocido; el proximo ciclo GPS lo actualizara
    v.estado = 'desconocido';
  }
  log('info', `Vehiculo ${key} → en_taller=${enTaller}`);
}

export function isEnTaller(codigo) {
  if (!codigo) return false;
  return !!_enTaller.get(codigo.toUpperCase());
}

// ── Getters ──────────────────────────────────────────────────────────────────

export function getVehiculos(filtroEmpresa) {
  const all = [..._vehiculos.values()].map(v => {
    const divConfig = getDivision(v.codigo);
    return {
      ...v,
      division: divConfig?.division || null,
      subgrupo: divConfig?.subgrupo || null,
    };
  });
  if (filtroEmpresa) {
    return all.filter(v => v.empresa === filtroEmpresa);
  }
  return all;
}

/** Overlay fresh division data from the divisiones cache */
function _conDivision(v) {
  if (!v) return null;
  const d = getDivision(v.codigo);
  return { ...v, division: d?.division || null, subgrupo: d?.subgrupo || null };
}

export function getVehiculoPorCodigo(codigo) {
  if (!codigo) return null;
  return _conDivision(_vehiculos.get(codigo.toUpperCase()));
}

export function getVehiculoPorPatente(patente) {
  if (!patente) return null;
  return _conDivision(_porPatente.get(patente.toUpperCase()));
}

export function getVehiculoPorNombre(nombre) {
  if (!nombre) return null;
  const codigoExtraido = extraerCodigo(nombre);
  return _conDivision(
    _vehiculos.get(nombre.toUpperCase())
      || (codigoExtraido ? _vehiculos.get(codigoExtraido) : null)
  );
}

export function getVehiculoPorIdGps(idgps) {
  if (!idgps) return null;
  return _conDivision(_porIdGps.get(idgps));
}

/** Obtener el odometro actual de un vehiculo por codigo */
export function getOdometro(codigo) {
  if (!codigo) return null;
  const v = _vehiculos.get(codigo.toUpperCase());
  return v?.odometro ?? null;
}

export function getResumenPorDivision(filtroEmpresa) {
  const resumen = {};
  for (const v of getVehiculos(filtroEmpresa)) {
    const div = v.division || 'Sin division';
    if (!resumen[div]) resumen[div] = {
      total: 0, en_ruta: 0, detenido: 0, inactivo: 0, alerta: 0, subgrupos: {}
    };
    resumen[div].total++;
    const k = v.estado === 'detenido_encendido' ? 'detenido' : (v.estado || 'inactivo');
    if (resumen[div][k] !== undefined) resumen[div][k]++;
    if (v.subgrupo) {
      resumen[div].subgrupos[v.subgrupo] = (resumen[div].subgrupos[v.subgrupo] || 0) + 1;
    }
  }
  return resumen;
}

export async function syncVehiculos() {
  return withSyncLog('vehicleGetAll+driverGetAll', _syncVehiculos);
}
