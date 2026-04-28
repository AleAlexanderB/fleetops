/**
 * sync-unidades-negocio.js — sincroniza unidades de negocio + categorías
 * (familias) desde el Hub.
 *
 * Hub es la fuente de verdad. FleetOps guarda copia local en
 * fleetops_unidades_negocio y fleetops_familias. UPSERT por id_externo;
 * soft-delete para los que dejaron de venir o quedaron inactivos.
 */

import { db } from '../../database/database.js';
import { marcarSync } from './sync.js';

const HUB_URL    = process.env.HUB_URL || 'http://ab_hub:3200';
const SYNC_KEY   = process.env.INTERNAL_SYNC_KEY;
const ORIGEN_UN  = 'hub_unidades_negocio';
const ORIGEN_FAM = 'hub_familias';
const TIMEOUT_MS = 5_000;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [SyncUnidades] ${msg}`);
}

async function fetchHub(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${HUB_URL}${path}`, {
      headers: { 'X-Internal-Api-Key': SYNC_KEY, accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'respuesta no OK');
    return json.data;
  } finally {
    clearTimeout(t);
  }
}

export async function sincronizarUnidadesNegocioDesdeHub() {
  if (!SYNC_KEY) { log('warn', 'INTERNAL_SYNC_KEY no configurada — skip'); return; }
  const pool = db();
  if (!pool) { log('warn', 'Sin DB — skip'); return; }

  let cantUnidades = 0;
  let cantFamilias = 0;

  try {
    // /api/v1/unidades-negocio?conFamilias=true devuelve cada unidad con
    // su array `familias` (categorias) ya anidado.
    const unidades = await fetchHub('/api/v1/unidades-negocio?conFamilias=true');

    const idsUnidadesVistos = new Set();
    const idsFamiliasVistos = new Set();

    for (const un of unidades) {
      if (un.eliminadoEn) continue;
      idsUnidadesVistos.add(un.id);

      await pool.execute(
        `INSERT INTO fleetops_unidades_negocio
           (id_externo, nombre, codigo, descripcion, activa, orden, sincronizado_en)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           nombre          = VALUES(nombre),
           codigo          = VALUES(codigo),
           descripcion     = VALUES(descripcion),
           activa          = VALUES(activa),
           orden           = VALUES(orden),
           sincronizado_en = NOW()`,
        [un.id, un.nombre, un.codigo, un.descripcion, un.activa ? 1 : 0, un.orden ?? null]
      );
      cantUnidades++;

      for (const f of (un.familias || [])) {
        if (f.eliminadoEn) continue;
        idsFamiliasVistos.add(f.id);
        await pool.execute(
          `INSERT INTO fleetops_familias
             (id_externo, unidad_negocio_id_externo, nombre, codigo, tipo, activa, sincronizado_en)
           VALUES (?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             unidad_negocio_id_externo = VALUES(unidad_negocio_id_externo),
             nombre                    = VALUES(nombre),
             codigo                    = VALUES(codigo),
             tipo                      = VALUES(tipo),
             activa                    = VALUES(activa),
             sincronizado_en           = NOW()`,
          [f.id, un.id, f.nombre, f.codigo ?? null, f.tipo ?? null, f.activa ? 1 : 0]
        );
        cantFamilias++;
      }
    }

    // Soft-delete: marcar inactivo lo que ya no aparece en el Hub
    if (idsUnidadesVistos.size > 0) {
      const placeholders = [...idsUnidadesVistos].map(() => '?').join(',');
      await pool.execute(
        `UPDATE fleetops_unidades_negocio
            SET activa = 0, sincronizado_en = NOW()
          WHERE id_externo NOT IN (${placeholders}) AND activa = 1`,
        [...idsUnidadesVistos]
      );
    }
    if (idsFamiliasVistos.size > 0) {
      const placeholders = [...idsFamiliasVistos].map(() => '?').join(',');
      await pool.execute(
        `UPDATE fleetops_familias
            SET activa = 0, sincronizado_en = NOW()
          WHERE id_externo NOT IN (${placeholders}) AND activa = 1`,
        [...idsFamiliasVistos]
      );
    }

    log('info', `OK · ${cantUnidades} unidades + ${cantFamilias} familias`);
    await marcarSync(ORIGEN_UN, true, cantUnidades, null);
    await marcarSync(ORIGEN_FAM, true, cantFamilias, null);
  } catch (err) {
    log('warn', `Falló: ${err.message} — sigue con copia local`);
    await marcarSync(ORIGEN_UN, false, cantUnidades, err.message);
    await marcarSync(ORIGEN_FAM, false, cantFamilias, err.message);
  }
}
