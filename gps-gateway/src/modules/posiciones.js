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
 *
 * PERSISTENCIA DE ESTADO:
 *   El mapa _geocercaAnterior se guarda en disco cada vez que hay un cambio
 *   y se restaura al arrancar. Esto evita perder transiciones al reiniciar.
 */
import { getEmpresas }             from '../core/empresas.js';
import { resolverVehiculo }         from './vehiculos.js';
import { getGeocercaPorUbicacion }  from './geocercas.js';
import { broadcast, getClientCount } from '../sse/broadcaster.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '../../geocerca-state.json');

// Estado actual: idgps → posicion enriquecida
const _posicionActual = new Map();

// Geocerca anterior por equipo: idgps → { id, nombre } | null
const _geocercaAnterior = new Map();

// En el primer ciclo sin estado persistido, solo inicializamos el mapa
// sin disparar eventos — evita "entradas falsas" para los 80+ equipos en geocercas
let _primerizoCiclo = false;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Posiciones] ${msg}`);
}

// ── Persistencia de estado ──────────────────────────────────────────────────

function _cargarEstado() {
  try {
    if (!existsSync(STATE_FILE)) {
      // Sin archivo de estado previo — primer ciclo solo inicializa, no dispara eventos
      _primerizoCiclo = true;
      log('info', 'Sin estado previo de geocercas — primer ciclo solo inicializará');
      return;
    }
    const raw  = readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    let count  = 0;
    for (const [idgps, geo] of Object.entries(data)) {
      _geocercaAnterior.set(idgps, geo || null);
      count++;
    }
    log('info', `Estado geocercas restaurado: ${count} equipos desde ${STATE_FILE}`);
  } catch (err) {
    _primerizoCiclo = true;
    log('warn', `No se pudo restaurar estado: ${err.message} — primer ciclo solo inicializará`);
  }
}

function _guardarEstado() {
  try {
    const obj = {};
    for (const [k, v] of _geocercaAnterior) obj[k] = v;
    writeFileSync(STATE_FILE, JSON.stringify(obj), 'utf8');
  } catch (err) {
    log('warn', `No se pudo guardar estado: ${err.message}`);
  }
}

// Restaurar al arrancar
_cargarEstado();

// ── Enriquecimiento de posición ─────────────────────────────────────────────

function enriquecerPosicion(p, empresa) {
  // Campos reales de RedGPS /getdata: GpsIdentif, UnitPlate, Latitude, Longitude,
  // GpsSpeed, Ignition, Direction, Conductor, ReportDate
  const idgps   = String(p.GpsIdentif ?? p.idgps ?? p.id ?? '');
  const patente = p.UnitPlate ?? p.plate ?? p.patente ?? '';
  const veh     = resolverVehiculo(idgps, patente);

  return {
    empresa,
    idgps,
    codigo:    veh?.codigo   || '',
    patente:   veh?.patente  || patente || '',
    etiqueta:  veh?.etiqueta || patente || idgps,
    lat:       parseFloat(p.Latitude  ?? p.lat  ?? p.latitude  ?? 0),
    lng:       parseFloat(p.Longitude ?? p.lng  ?? p.longitude ?? 0),
    velocidad: parseFloat(p.GpsSpeed  ?? p.speed ?? p.velocidad ?? 0),
    ignicion:  p.Ignition ?? p.ignition ?? p.ignicion ?? 0,
    rumbo:     parseFloat(p.Direction ?? p.course ?? p.rumbo ?? 0),
    conductor: p.Conductor ?? p.conductor ?? null,
    timestamp: p.ReportDate ?? p.datetime ?? p.date ?? new Date().toISOString(),
    geocerca:  null,   // se rellena después
  };
}

export async function pollPosiciones() {
  const empresas  = getEmpresas();
  const nuevas    = [];
  let enGeocerca  = 0;
  let estadoCambio = false;

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
        const actual   = geo ? { id: String(geo.id), nombre: geo.nombre } : null;

        if (anterior?.id !== actual?.id) {
          // En primer ciclo sin estado previo: solo inicializar, no disparar eventos
          if (!_primerizoCiclo) {
            if (anterior) {
              log('info', `← SALIDA: ${pos.etiqueta || pos.idgps} salió de "${anterior.nombre}"`);
              broadcast('geocerca_salida', {
                equipo:    { idgps: pos.idgps, codigo: pos.codigo, patente: pos.patente, etiqueta: pos.etiqueta, empresa: nombre },
                geocerca:  anterior,
                timestamp: pos.timestamp,
              });
            }
            if (actual) {
              log('info', `→ ENTRADA: ${pos.etiqueta || pos.idgps} entró a "${actual.nombre}"`);
              broadcast('geocerca_entrada', {
                equipo:    { idgps: pos.idgps, codigo: pos.codigo, patente: pos.patente, etiqueta: pos.etiqueta, empresa: nombre },
                geocerca:  actual,
                timestamp: pos.timestamp,
              });
            }
          }
          _geocercaAnterior.set(pos.idgps, actual);
          estadoCambio = true;
        }

        _posicionActual.set(pos.idgps, pos);
        nuevas.push(pos);
      }
      log('info', `[${nombre}] getdata: ${lista.length} unidades`);
    } catch (err) {
      log('error', `[${nombre}] Error en pollPosiciones: ${err.message}`);
    }
  }

  // Guardar estado solo cuando hubo cambios (evitar escrituras innecesarias)
  if (estadoCambio) _guardarEstado();

  // Marcar que el primer ciclo terminó — de ahora en adelante disparar eventos normalmente
  if (_primerizoCiclo) {
    _primerizoCiclo = false;
    log('info', `Primer ciclo completado — estado inicializado para ${_geocercaAnterior.size} equipos. Eventos activos.`);
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
