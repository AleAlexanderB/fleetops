/**
 * posiciones.js
 *
 * Polling getdata cada 30s — núcleo del gateway.
 *
 * Por cada ciclo:
 *   1. Llama getdata a todas las empresas
 *   2. Resuelve vehículo (idgps → código/patente/etiqueta)
 *   3. Detecta geocerca actual
 *   4. Detecta entradas/salidas (comparando con ciclo anterior)
 *   5. Emite via SSE:
 *      - "positions_update": snapshot completo de posiciones
 *      - "geocerca_entrada": cuando un equipo entra a una geocerca
 *      - "geocerca_salida": cuando un equipo sale de una geocerca
 */
import { getEmpresas }             from '../core/empresas.js';
import { resolverVehiculo }         from './vehiculos.js';
import { getGeocercaPorUbicacion }  from './geocercas.js';
import { broadcast, getClientCount } from '../sse/broadcaster.js';

// Estado actual: idgps → posicion enriquecida
const _posicionActual = new Map();

// Geocerca anterior por equipo: idgps → { id, nombre } | null
const _geocercaAnterior = new Map();

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Posiciones] ${msg}`);
}

function enriquecerPosicion(p, empresa) {
  const idgps = String(p.idgps ?? p.id ?? '');
  const veh   = resolverVehiculo(idgps, p.plate ?? p.patente ?? '');

  return {
    empresa,
    idgps,
    codigo:     veh?.codigo   || p.name    || '',
    patente:    veh?.patente  || p.plate   || p.patente || '',
    etiqueta:   veh?.etiqueta || p.name    || p.plate   || idgps,
    lat:        parseFloat(p.lat  ?? p.latitude  ?? 0),
    lng:        parseFloat(p.lng  ?? p.longitude ?? 0),
    velocidad:  parseFloat(p.speed    ?? p.velocidad ?? 0),
    ignicion:   p.ignition ?? p.ignicion ?? p.acc ?? 0,
    rumbo:      parseFloat(p.course   ?? p.rumbo    ?? 0),
    odometro:   parseFloat(p.odometer ?? p.odometro ?? 0),
    bateria:    p.battery ?? null,
    timestamp:  p.datetime ?? p.date ?? new Date().toISOString(),
    geocerca:   null,   // se rellena después
  };
}

export async function pollPosiciones() {
  const empresas  = getEmpresas();
  const nuevas    = [];
  let enGeocerca  = 0;

  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/getdata');
      const lista = Array.isArray(data) ? data : (data?.units || data?.data || []);

      for (const p of lista) {
        const pos = enriquecerPosicion(p, nombre);
        if (!pos.idgps || !pos.lat || !pos.lng) continue;

        // Detectar geocerca actual
        const geo = getGeocercaPorUbicacion(pos.lat, pos.lng, nombre);
        if (geo) {
          pos.geocerca = { id: geo.id, nombre: geo.nombre };
          enGeocerca++;
        }

        // Detectar entrada/salida
        const anterior = _geocercaAnterior.get(pos.idgps) ?? null;
        const actual   = geo ? { id: geo.id, nombre: geo.nombre } : null;

        if (anterior?.id !== actual?.id) {
          if (anterior) {
            broadcast('geocerca_salida', {
              equipo:   { idgps: pos.idgps, codigo: pos.codigo, patente: pos.patente, etiqueta: pos.etiqueta, empresa: nombre },
              geocerca: anterior,
            });
          }
          if (actual) {
            broadcast('geocerca_entrada', {
              equipo:   { idgps: pos.idgps, codigo: pos.codigo, patente: pos.patente, etiqueta: pos.etiqueta, empresa: nombre },
              geocerca: actual,
            });
          }
          _geocercaAnterior.set(pos.idgps, actual);
        }

        _posicionActual.set(pos.idgps, pos);
        nuevas.push(pos);
      }
      log('info', `[${nombre}] getdata: ${lista.length} unidades`);
    } catch (err) {
      log('error', `[${nombre}] Error en pollPosiciones: ${err.message}`);
    }
  }

  log('info', `Total: ${nuevas.length} unidades | en geocerca: ${enGeocerca} | SSE clientes: ${getClientCount()}`);

  // Broadcast snapshot completo
  broadcast('positions_update', { positions: nuevas });

  return { total: nuevas.length, enGeocerca };
}

export function getPosiciones(empresaFiltro) {
  const lista = [..._posicionActual.values()];
  if (empresaFiltro) return lista.filter(p => p.empresa === empresaFiltro);
  return lista;
}

export function getPosicionPorIdGps(idgps) {
  return _posicionActual.get(String(idgps)) || null;
}
