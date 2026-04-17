/**
 * geocercas.js
 * Sincroniza geocercas de RedGPS y provee detección de posición.
 *
 * Campos reales de RedGPS (/getGeofences):
 *   g.idCerca, g.nombre, g.puntos (array o JSON string), g.visible,
 *   g.radio, g.tipoCerca (número o string), g.idtipo_cerca
 */
import { getEmpresas } from '../core/empresas.js';

const _geocercas = new Map(); // `empresa:idCerca` → geocerca

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Geocercas] ${msg}`);
}

// ── Algoritmos geométricos ────────────────────────────────────────────────────

function puntoDentroPoligono(lat, lng, puntos) {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const xi = puntos[i].lat, yi = puntos[i].lng;
    const xj = puntos[j].lat, yj = puntos[j].lng;
    const intersecta = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersecta) dentro = !dentro;
  }
  return dentro;
}

function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parsePuntos(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map(p => ({
      lat: parseFloat(p.lat ?? p.latitude  ?? p.Latitude  ?? p.Lat ?? 0),
      lng: parseFloat(p.lng ?? p.longitude ?? p.Longitude ?? p.Lng ?? p.lon ?? 0),
    })).filter(p => p.lat !== 0 || p.lng !== 0);
  } catch { return []; }
}

function resolverTipo(g) {
  const MAPA = { poligonal: 1, polygon: 1, circular: 2, circle: 2, lineal: 3, line: 3, ruta: 3 };
  if (typeof g.tipoCerca === 'number') return g.tipoCerca;
  if (typeof g.idtipo_cerca === 'number') return g.idtipo_cerca;
  if (typeof g.tipoCerca === 'string') return MAPA[g.tipoCerca.toLowerCase()] ?? 1;
  if (typeof g.tipo_cerca === 'string') return MAPA[g.tipo_cerca.toLowerCase()] ?? 1;
  return 1; // default: poligonal
}

function normalizar(g, empresa) {
  const puntos = parsePuntos(g.puntos);
  return {
    empresa,
    id:      String(g.idCerca ?? g.id ?? ''),
    nombre:  g.nombre || g.name || '',
    tipo:    resolverTipo(g),
    radio:   parseFloat(g.radio ?? g.radius ?? 0),
    visible: g.visible == null ? 1 : Number(g.visible),
    puntos,
  };
}

export async function syncGeocercas() {
  const empresas = getEmpresas();
  let total = 0;

  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/getGeofences');
      if (!Array.isArray(data)) {
        log('warn', `[${nombre}] getGeofences no devolvió un array`);
        continue;
      }

      let count = 0;
      for (const g of data) {
        const geo = normalizar(g, nombre);
        if (!geo.id) continue;
        if (Number(geo.visible) === 0) continue;             // oculta
        if (geo.tipo !== 2 && geo.puntos.length === 0) continue; // sin puntos y no circular
        _geocercas.set(`${nombre}:${geo.id}`, geo);
        count++;
      }
      total += count;
      log('info', `[${nombre}] ${count}/${data.length} geocercas activas sincronizadas`);
    } catch (err) {
      log('error', `[${nombre}] Error al sincronizar geocercas: ${err.message}`);
    }
  }

  log('info', `Total sincronizadas: ${total} geocercas de ${empresas.length} empresa(s)`);
  return { total };
}

export function getGeocercas(empresaFiltro) {
  const lista = [..._geocercas.values()];
  if (empresaFiltro) return lista.filter(g => g.empresa === empresaFiltro);
  return lista;
}

export function getGeocercaPorId(id) {
  for (const g of _geocercas.values()) {
    if (g.id === String(id)) return g;
  }
  return null;
}

/** Retorna la primera geocerca donde está el punto, o null */
export function getGeocercaPorUbicacion(lat, lng, empresaFiltro) {
  if (!lat || !lng) return null;
  const lista = empresaFiltro
    ? [..._geocercas.values()].filter(g => g.empresa === empresaFiltro)
    : [..._geocercas.values()];

  for (const g of lista) {
    if (g.tipo === 2) {
      // Circular: centro = puntos[0], radio en metros
      if (g.puntos.length > 0 && g.radio > 0) {
        if (distanciaMetros(lat, lng, g.puntos[0].lat, g.puntos[0].lng) <= g.radio) return g;
      }
    } else if (g.tipo === 1 && g.puntos.length >= 3) {
      // Poligonal
      if (puntoDentroPoligono(lat, lng, g.puntos)) return g;
    }
    // tipo 3 (lineal) requiere buffer - no implementado
  }
  return null;
}
