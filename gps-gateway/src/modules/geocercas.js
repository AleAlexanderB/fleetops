/**
 * geocercas.js
 * Sincroniza geocercas de RedGPS y provee detección de posición.
 */
import { getEmpresas } from '../core/empresas.js';

const _geocercas = new Map(); // id → geocerca

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

function normalizar(g, empresa) {
  const puntos = (g.points || g.puntos || []).map(p => ({
    lat: parseFloat(p.lat ?? p.latitude  ?? 0),
    lng: parseFloat(p.lng ?? p.longitude ?? 0),
  }));
  return {
    empresa,
    id:     String(g.idgeofence ?? g.id ?? ''),
    nombre: g.name  || g.nombre || '',
    tipo:   parseInt(g.type ?? g.tipo ?? 1),  // 1=poligono, 2=circular
    radio:  parseFloat(g.radio ?? g.radius ?? 0),
    puntos,
    activa: g.active !== false && g.show !== false,
  };
}

export async function syncGeocercas() {
  const empresas = getEmpresas();
  let total = 0;

  for (const { nombre, client } of empresas) {
    try {
      const data = await client.post('/getGeofences');
      const lista = Array.isArray(data) ? data : (data?.geofences || data?.data || []);

      for (const g of lista) {
        const geo = normalizar(g, nombre);
        if (geo.id && geo.activa && geo.puntos.length > 0) {
          _geocercas.set(geo.id, geo);
          total++;
        }
      }
      log('info', `[${nombre}] ${lista.length} geocercas procesadas`);
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
  return _geocercas.get(String(id)) || null;
}

/** Retorna la geocerca donde está el punto, o null */
export function getGeocercaPorUbicacion(lat, lng, empresaFiltro) {
  const lista = empresaFiltro
    ? [..._geocercas.values()].filter(g => g.empresa === empresaFiltro)
    : [..._geocercas.values()];

  for (const g of lista) {
    if (g.tipo === 2) {
      // Circular
      if (g.puntos.length > 0 && distanciaMetros(lat, lng, g.puntos[0].lat, g.puntos[0].lng) <= g.radio) {
        return g;
      }
    } else if (g.tipo === 1 && g.puntos.length >= 3) {
      // Poligonal
      if (puntoDentroPoligono(lat, lng, g.puntos)) return g;
    }
  }
  return null;
}
