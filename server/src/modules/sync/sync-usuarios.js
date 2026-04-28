/**
 * sync-usuarios.js — sincroniza usuarios desde el Hub.
 *
 * Modelo:
 * - El Hub es la fuente de verdad. Cada 10 min consultamos /api/v1/usuarios
 *   y /api/v1/empresas y hacemos UPSERT local por id_externo.
 * - Solo se sincronizan usuarios con permiso explícito en el módulo "fleetops"
 *   (campo permisos.fleetops). Los demás se ignoran o desactivan si ya estaban.
 * - Soft-delete: usuarios con id_externo que dejaron de venir del Hub o
 *   perdieron permiso → activo = false. Nunca se borran filas (audit trail).
 * - Usuarios LOCALES (id_externo IS NULL — admin, corralon, viap, etc.) NO
 *   se tocan. Login local sigue funcionando hasta que migremos a SSO único.
 */

import { db } from '../../database/database.js';
import { marcarSync } from './sync.js';

const HUB_URL    = process.env.HUB_URL || 'http://ab_hub:3200';
const SYNC_KEY   = process.env.INTERNAL_SYNC_KEY;
const ORIGEN     = 'hub_usuarios';
const TIMEOUT_MS = 5_000;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [SyncUsuarios] ${msg}`);
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

/**
 * Construye el rol local a partir de los permisos del Hub.
 * permisos.fleetops.rol = 'admin' → 'admin' local
 * permisos.fleetops.rol = 'editor' / 'lector' → 'empresa' local
 * Sin permiso fleetops → null (no se sincroniza).
 */
function resolverRolLocal(permisosHub) {
  const fleet = permisosHub.find(p => p.modulo === 'fleetops');
  if (!fleet) return null;
  return fleet.rol === 'admin' ? 'admin' : 'empresa';
}

export async function sincronizarUsuariosDesdeHub() {
  if (!SYNC_KEY) {
    log('warn', 'INTERNAL_SYNC_KEY no configurada — skip');
    return;
  }
  const pool = db();
  if (!pool) {
    log('warn', 'Sin DB — skip');
    return;
  }

  let cantidad = 0;
  try {
    // 1) Cargar empresas del Hub para mapear ID → nombreCorto
    const empresas = await fetchHub('/api/v1/empresas');
    const empresaIdToNombre = new Map(
      empresas.map(e => [e.id, e.nombreCorto || e.nombre])
    );

    // 2) Cargar usuarios del Hub
    const usuarios = await fetchHub('/api/v1/usuarios?limit=200');

    // 3) UPSERT por id_externo
    const idsHubVistos = new Set();
    for (const u of usuarios) {
      const rolLocal = resolverRolLocal(u.permisos || []);
      if (!rolLocal) continue;          // no tiene acceso a fleetops
      if (u.eliminadoEn) continue;      // borrado en Hub
      idsHubVistos.add(u.id);

      const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ').trim() || u.email;
      const empresaPrincipal = u.empresas?.length
        ? (empresaIdToNombre.get(u.empresas[0]) || null)
        : null;
      const username = (u.email || `user_${u.id}`).toLowerCase();

      await pool.execute(
        `INSERT INTO fleetops_usuarios
           (id_externo, username, email, password_hash, nombre, rol, empresa, activo, sincronizado_en)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           username        = VALUES(username),
           email           = VALUES(email),
           nombre          = VALUES(nombre),
           rol             = VALUES(rol),
           empresa         = VALUES(empresa),
           activo          = VALUES(activo),
           sincronizado_en = NOW()`,
        [u.id, username, u.email, nombreCompleto, rolLocal, empresaPrincipal, u.activo ? 1 : 0]
      );
      cantidad++;
    }

    // 4) Soft-delete: id_externo NOT NULL que ya no aparecen en Hub
    if (idsHubVistos.size > 0) {
      const placeholders = [...idsHubVistos].map(() => '?').join(',');
      const [result] = await pool.execute(
        `UPDATE fleetops_usuarios
            SET activo = 0, sincronizado_en = NOW()
          WHERE id_externo IS NOT NULL
            AND id_externo NOT IN (${placeholders})
            AND activo = 1`,
        [...idsHubVistos]
      );
      if (result.affectedRows > 0) {
        log('warn', `Desactivados ${result.affectedRows} usuarios que ya no estan en Hub`);
      }
    }

    log('info', `OK · ${cantidad} usuarios sincronizados desde Hub`);
    await marcarSync(ORIGEN, true, cantidad, null);
  } catch (err) {
    log('warn', `Falló: ${err.message} — sigue con copia local`);
    await marcarSync(ORIGEN, false, cantidad, err.message);
  }
}
