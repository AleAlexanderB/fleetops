/**
 * sync-equipos.js — sincroniza asignaciones equipo→unidad de negocio
 * desde el sistema Equipos (E:\001-EQUIPOS).
 *
 * Equipos es la fuente de verdad de "qué activo está asignado a qué
 * unidad de negocio y subdivisión". FleetOps cruza esos datos con sus
 * vehículos GPS por código del equipo (codigoInterno en Equipos =
 * codigo en FleetOps).
 *
 * Como hoy /api/activos de Equipos paginar por defecto 25, hay que
 * iterar páginas hasta agotar.
 */

import { db } from '../../database/database.js';
import { marcarSync } from './sync.js';

const EQUIPOS_URL = process.env.EQUIPOS_URL || 'http://equipos_app:8078';
const SYNC_KEY    = process.env.INTERNAL_SYNC_KEY;
const ORIGEN      = 'equipos_activos';
const TIMEOUT_MS  = 8_000;
const PAGE_SIZE   = 100;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [SyncEquipos] ${msg}`);
}

async function fetchEquipos(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${EQUIPOS_URL}${path}`, {
      headers: { 'X-Internal-Api-Key': SYNC_KEY, accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'respuesta no OK');
    return json;
  } finally {
    clearTimeout(t);
  }
}

export async function sincronizarEquiposDesdeEquipos() {
  if (!SYNC_KEY) { log('warn', 'INTERNAL_SYNC_KEY no configurada — skip'); return; }
  const pool = db();
  if (!pool) { log('warn', 'Sin DB — skip'); return; }

  let cantidad = 0;
  try {
    const codigosVistos = new Set();
    let page = 1;
    let total = 0;
    while (true) {
      const json = await fetchEquipos(`/api/activos?pageSize=${PAGE_SIZE}&page=${page}`);
      total = json.total ?? 0;
      const items = json.data ?? [];
      if (items.length === 0) break;

      for (const a of items) {
        const codigo = a.codigoInterno || a.patente;
        if (!codigo) continue;
        codigosVistos.add(codigo);

        await pool.execute(
          `INSERT INTO fleetops_equipo_asignacion
             (codigo_equipo, patente, unidad_negocio_id, unidad_negocio_nombre,
              subdivision_id, subdivision_nombre, estado, empresa_id, empresa_codigo,
              sincronizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             patente               = VALUES(patente),
             unidad_negocio_id     = VALUES(unidad_negocio_id),
             unidad_negocio_nombre = VALUES(unidad_negocio_nombre),
             subdivision_id        = VALUES(subdivision_id),
             subdivision_nombre    = VALUES(subdivision_nombre),
             estado                = VALUES(estado),
             empresa_id            = VALUES(empresa_id),
             empresa_codigo        = VALUES(empresa_codigo),
             sincronizado_en       = NOW()`,
          [
            codigo,
            a.patente ?? null,
            a.unidadNegocioId ?? null,
            a.unidadNegocio?.nombre ?? null,
            a.subdivisionNegocioId ?? null,
            a.subdivisionNegocio?.nombre ?? null,
            a.estado ?? null,
            a.empresaId ?? null,
            a.empresa?.codigo ?? null,
          ]
        );
        cantidad++;
      }

      if (items.length < PAGE_SIZE) break;
      page++;
      if (page > 20) { log('warn', 'Loop guard: parando en page 20'); break; }
    }

    log('info', `OK · ${cantidad}/${total} asignaciones sincronizadas desde Equipos`);
    await marcarSync(ORIGEN, true, cantidad, null);
  } catch (err) {
    log('warn', `Falló: ${err.message} — sigue con copia local`);
    await marcarSync(ORIGEN, false, cantidad, err.message);
  }
}
