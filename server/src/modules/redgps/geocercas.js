/**
 * geocercas.js
 *
 * Sincroniza geocercas desde RedGPS y provee deteccion de ubicacion.
 * v9: Multi-empresa — sincroniza geocercas de todas las cuentas RedGPS.
 *     Cada geocerca tiene campo `empresa`.
 */

import { withSyncLog }  from '../../database/sync-log.js';
import { getVehiculos } from './vehiculos.js';
import { gatewayGet }   from '../../gateway/gateway-client.js';

let _geocercas = [];   // array de geocercas enriquecidas

function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  console[level](`[${ts}] [Geocercas] ${msg}`, Object.keys(data).length ? data : '');
}

// ── Sync desde gateway REST ──────────────────────────────────────────────────

async function _syncGeocercas() {
  // Preservar stats del sync anterior
  const oldStats = new Map();
  for (const g of _geocercas) {
    oldStats.set(`${g.empresa}:${g.idCerca}`, {
      ingresosHoy:   g.ingresosHoy,
      salidasHoy:    g.salidasHoy,
      equiposDentro: g.equiposDentro,
    });
  }

  const lista = await gatewayGet('/api/geocercas');
  const todasGeocercas = [];

  for (const item of lista) {
    const key  = `${item.empresa}:${item.id}`;
    const prev = oldStats.get(key);

    todasGeocercas.push({
      idCerca:         item.id,
      nombre:          item.nombre,
      tipoCerca:       item.tipo,
      color:           null,
      radio:           item.radio || 0,
      limiteVelocidad: null,
      visible:         item.visible ?? 1,
      puntos:          item.puntos || [],
      empresa:         item.empresa,
      division:        null,
      subgrupo:        null,
      ingresosHoy:     prev?.ingresosHoy   ?? 0,
      salidasHoy:      prev?.salidasHoy    ?? 0,
      equiposDentro:   prev?.equiposDentro ?? new Set(),
    });
  }

  _geocercas = todasGeocercas;

  // Recomputar equiposDentro desde posiciones actuales de vehiculos
  const vehiculos = getVehiculos();
  for (const v of vehiculos) {
    if (v.latitud && v.longitud) {
      const geo = getGeoercaPorUbicacion(v.latitud, v.longitud);
      if (geo) geo.equiposDentro.add(v.codigo);
    }
  }

  log('info', `[GatewaySync] ${_geocercas.length} geocercas sincronizadas desde gateway`);

  // Log de diagnostico
  const resumen = { poligonal: 0, circular: 0, lineal: 0, ocultas: 0, sinPuntos: 0 };
  for (const g of _geocercas) {
    if (Number(g.visible) === 0) { resumen.ocultas++; continue; }
    if (Number(g.tipoCerca) === 1) resumen.poligonal++;
    else if (Number(g.tipoCerca) === 2) resumen.circular++;
    else if (Number(g.tipoCerca) === 3) resumen.lineal++;
    if (!g.puntos || g.puntos.length === 0) resumen.sinPuntos++;
  }
  log('info', `Tipos → poligonal:${resumen.poligonal} circular:${resumen.circular} lineal:${resumen.lineal} ocultas:${resumen.ocultas} sinPuntos:${resumen.sinPuntos}`);

  // Muestra de geocercas con detalle de puntos para diagnostico
  const muestra = _geocercas.filter(g => Number(g.visible) !== 0).slice(0, 3);
  for (const g of muestra) {
    const p0 = g.puntos[0] || {};
    log('info', `  ↳ "${g.nombre}" [${g.empresa}] tipo=${g.tipoCerca} puntos=${g.puntos.length} radio=${g.radio} muestra=${JSON.stringify(p0)}`);
  }

  return _geocercas;
}

/** Resolver tipo de geocerca a numero 1/2/3 desde multiples formatos de API */
function _resolverTipoCerca(g) {
  // Mapa de strings a numeros
  const MAPA = { poligonal: 1, polygon: 1, circular: 2, circle: 2, lineal: 3, line: 3, ruta: 3 };

  // 1) tipo_cerca como string → mapear
  if (typeof g.tipo_cerca === 'string') {
    const mapped = MAPA[g.tipo_cerca.toLowerCase().trim()];
    if (mapped) return mapped;
  }

  // 2) tipo_cerca como numero valido (1, 2, 3)
  const tc = Number(g.tipo_cerca);
  if (tc >= 1 && tc <= 3) return tc;

  // 3) idtipo_cerca como numero valido
  const itc = Number(g.idtipo_cerca);
  if (itc >= 1 && itc <= 3) return itc;

  // 4) Default: poligonal
  return 1;
}

function parsePuntos(rawPuntos) {
  if (!rawPuntos) return [];
  try {
    const puntos = typeof rawPuntos === 'string' ? JSON.parse(rawPuntos) : rawPuntos;
    if (!Array.isArray(puntos)) return [];

    // Normalizar formato de puntos: aceptar lat/lng, latitude/longitude, Latitude/Longitude
    return puntos.map(p => ({
      lat: parseFloat(p.lat ?? p.latitude ?? p.Latitude ?? p.Lat ?? 0),
      lng: parseFloat(p.lng ?? p.longitude ?? p.Longitude ?? p.Lng ?? p.lon ?? p.Lon ?? 0),
    })).filter(p => p.lat !== 0 || p.lng !== 0);
  } catch {
    return [];
  }
}

// ── Deteccion de ubicacion ───────────────────────────────────────────────────

export function getGeoercaPorUbicacion(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return null;

  for (const geo of _geocercas) {
    if (Number(geo.visible) === 0) continue;

    const tipo = Number(geo.tipoCerca);

    if (tipo === 2 && geo.radio > 0) {
      if (!geo.puntos[0]) continue;
      const dist = haversine(lat, lng, geo.puntos[0].lat, geo.puntos[0].lng);
      if (dist <= geo.radio) return geo;
    } else if (tipo === 3 && geo.puntos.length >= 2) {
      const buffer = geo.radio > 0 ? geo.radio : 50;
      if (puntoEnLinealConBuffer(lat, lng, geo.puntos, buffer)) return geo;
    } else if (geo.puntos.length >= 3) {
      if (puntoDentroDePoligono(lat, lng, geo.puntos)) return geo;
    }
  }
  return null;
}

// ── Algoritmos geometricos ───────────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

function puntoDentroDePoligono(lat, lng, puntos) {
  if (!puntos || puntos.length < 3) return false;
  let inside = false;
  const n = puntos.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = puntos[i].lng, yi = puntos[i].lat;
    const xj = puntos[j].lng, yj = puntos[j].lat;
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function puntoEnLinealConBuffer(lat, lng, puntos, bufferMetros) {
  for (let i = 0; i < puntos.length - 1; i++) {
    const dist = distanciaPuntoASegmento(lat, lng, puntos[i], puntos[i + 1]);
    if (dist <= bufferMetros) return true;
  }
  return false;
}

function distanciaPuntoASegmento(lat, lng, p1, p2) {
  const d12 = haversine(p1.lat, p1.lng, p2.lat, p2.lng);
  if (d12 === 0) return haversine(lat, lng, p1.lat, p1.lng);

  const t = Math.max(0, Math.min(1,
    ((lat - p1.lat) * (p2.lat - p1.lat) + (lng - p1.lng) * (p2.lng - p1.lng)) /
    ((p2.lat - p1.lat) ** 2 + (p2.lng - p1.lng) ** 2)
  ));

  const projLat = p1.lat + t * (p2.lat - p1.lat);
  const projLng = p1.lng + t * (p2.lng - p1.lng);
  return haversine(lat, lng, projLat, projLng);
}

// ── Actualizacion de estadisticas ────────────────────────────────────────────

/**
 * Reemplaza equiposDentro de todas las geocercas de una sola vez (atomico).
 * @param {Map<number|string, Set<string>>} nuevoMapa — idCerca → Set de codigos
 */
export function actualizarTodosEquiposDentro(nuevoMapa) {
  for (const g of _geocercas) {
    g.equiposDentro = nuevoMapa.get(g.idCerca) || new Set();
  }
}

// Legacy — ya no se usa en el poll, pero se mantiene por compatibilidad
export function limpiarEquiposDentro() {
  for (const g of _geocercas) g.equiposDentro = new Set();
}

export function actualizarEquiposDentro(idCerca, codigo) {
  const geo = _geocercas.find(g => g.idCerca === idCerca);
  if (geo) geo.equiposDentro.add(codigo);
}

export function registrarIngreso(idCerca, patente) {
  const geo = _geocercas.find(g => g.idCerca === idCerca);
  if (geo) { geo.ingresosHoy++; geo.equiposDentro.add(patente); }
}

export function registrarSalida(idCerca, patente) {
  const geo = _geocercas.find(g => g.idCerca === idCerca);
  if (geo) { geo.salidasHoy++; geo.equiposDentro.delete(patente); }
}

// ── Getters ──────────────────────────────────────────────────────────────────

export function getGeocercas(filtroEmpresa) {
  let lista = _geocercas;
  if (filtroEmpresa) {
    lista = lista.filter(g => g.empresa === filtroEmpresa);
  }
  return lista.map(g => ({
    ...g,
    equiposDentro: [...g.equiposDentro],
  }));
}

export function getGeocercaPorId(idCerca) {
  return _geocercas.find(g => g.idCerca === idCerca) || null;
}

export async function syncGeocercas() {
  return withSyncLog('getGeofences', _syncGeocercas);
}
