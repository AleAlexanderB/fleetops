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

import { getEmpresas } from '../../core/empresas.js';
import { getDivision } from '../divisiones/divisiones.js';
import { withSyncLog }  from '../../database/sync-log.js';

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

// ── Sync desde RedGPS (todas las empresas) ───────────────────────────────────

async function _syncVehiculos() {
  const empresas = getEmpresas();
  const nuevos     = new Map();
  const porPatente = new Map();
  const porIdGps   = new Map();
  let totalSinPatente = 0;

  for (const empresa of empresas) {
    try {
      const [listaVehiculos, listaChoferes] = await Promise.all([
        empresa.client.post('/vehicleGetAll'),
        empresa.client.post('/driverGetAll'),
      ]);

      const choferMap = new Map();
      if (Array.isArray(listaChoferes)) {
        for (const c of listaChoferes) {
          if (c.idvehiculo) {
            choferMap.set(String(c.idvehiculo), {
              id:       c.id,
              nombre:   `${c.nombre} ${c.apellido}`.trim(),
              licencia: c.licencia,
              cedula:   c.cedula,
              telefono: c.telefono,
            });
          }
        }
      }

      if (Array.isArray(listaVehiculos)) {
        for (const v of listaVehiculos) {
          const codigo = extraerCodigo(v.nombre);
          if (!codigo) continue;

          const patente   = v.patente?.trim() || null;
          const divConfig = getDivision(codigo);
          const chofer    = choferMap.get(String(v.id)) || null;
          const etiqueta  = patente || codigo;

          // Preservar estado dinamico si el vehiculo ya existia en memoria
          const existente = _vehiculos.get(codigo);

          const vehiculo = {
            // Identificadores
            codigo,
            id:           v.id,
            idgps:        v.idgps || null,
            nombre:       v.nombre,
            patente,
            etiqueta,
            tienePatente: !!patente,

            // Multi-empresa
            empresa:      empresa.nombre,

            // Datos del vehiculo
            marca:        v.marca   || null,
            modelo:       v.modelo  || null,
            anio:         v.anio    || null,
            color:        v.color   || null,
            grupoRedGps:  v.grupo   || null,
            tipo:         v.tipo_vehiculo || null,

            // Asignacion local
            division:     divConfig?.division || null,
            subgrupo:     divConfig?.subgrupo || null,
            chofer,

            // Estado dinamico — preservar si ya existe
            estado:              existente?.estado              || 'desconocido',
            velocidad:           existente?.velocidad           || 0,
            latitud:             existente?.latitud             || null,
            longitud:            existente?.longitud            || null,
            geocercaActual:      existente?.geocercaActual      || null,
            ultimaActualizacion: existente?.ultimaActualizacion || null,
            conductor:           existente?.conductor           || null,
          };

          nuevos.set(codigo, vehiculo);

          if (patente) {
            porPatente.set(patente.toUpperCase(), vehiculo);
          } else {
            totalSinPatente++;
          }

          if (v.idgps) {
            porIdGps.set(v.idgps, vehiculo);
          }
        }
      }

      log('info', `[${empresa.nombre}] ${listaVehiculos?.length ?? 0} vehiculos sincronizados`);
    } catch (err) {
      log('error', `[${empresa.nombre}] Error sincronizando vehiculos: ${err.message}`);
      // No lanzar — continuar con las demas empresas
    }
  }

  _vehiculos  = nuevos;
  _porPatente = porPatente;
  _porIdGps   = porIdGps;

  log('info', `Total sincronizados: ${nuevos.size} equipos (${totalSinPatente} sin patente) de ${empresas.length} empresa(s)`);
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
