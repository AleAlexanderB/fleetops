/**
 * sync.js — orquestación de sincronización con Hub y Equipos.
 *
 * Cada origen tiene un worker que corre al bootstrap y cada N minutos.
 * Si el upstream falla, log de warning y se sigue con la última copia local.
 *
 * Auth: service-key (header X-Internal-Api-Key). Todos los sistemas del
 * ecosistema comparten la misma INTERNAL_SYNC_KEY.
 */

import { db } from '../../database/database.js';
import { sincronizarUsuariosDesdeHub } from './sync-usuarios.js';
import { sincronizarUnidadesNegocioDesdeHub } from './sync-unidades-negocio.js';
import { sincronizarEquiposDesdeEquipos } from './sync-equipos.js';

const INTERVALO_MIN = parseInt(process.env.SYNC_INTERVAL_MIN) || 10;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Sync] ${msg}`);
}

/**
 * Registra el resultado de una corrida en fleetops_sync_status.
 */
export async function marcarSync(origen, ok, cantidad, error) {
  const pool = db();
  if (!pool) return;
  try {
    await pool.execute(
      `INSERT INTO fleetops_sync_status (origen, sincronizado_en, ok, cantidad, error)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         sincronizado_en = VALUES(sincronizado_en),
         ok              = VALUES(ok),
         cantidad        = VALUES(cantidad),
         error           = VALUES(error)`,
      [origen, ok ? new Date() : null, ok ? 1 : 0, cantidad ?? null, error ?? null]
    );
  } catch (e) {
    log('warn', `marcarSync(${origen}): ${e.message}`);
  }
}

/**
 * Devuelve el estado de sincronización de cada origen registrado.
 */
export async function getSyncStatus() {
  const pool = db();
  if (!pool) return [];
  try {
    const [rows] = await pool.execute(
      `SELECT origen, sincronizado_en, ok, cantidad, error, actualizado_en
         FROM fleetops_sync_status
        ORDER BY origen ASC`
    );
    return rows.map(r => ({
      origen:          r.origen,
      sincronizadoEn:  r.sincronizado_en?.toISOString?.() ?? r.sincronizado_en,
      ok:              !!r.ok,
      cantidad:        r.cantidad,
      error:           r.error,
      actualizadoEn:   r.actualizado_en?.toISOString?.() ?? r.actualizado_en,
    }));
  } catch (e) {
    log('warn', `getSyncStatus: ${e.message}`);
    return [];
  }
}

/**
 * Bootstrap: corre todas las sincronizaciones una vez al arrancar y
 * programa la repetición cada INTERVALO_MIN minutos.
 */
export async function initSync() {
  if (!process.env.INTERNAL_SYNC_KEY) {
    log('warn', 'INTERNAL_SYNC_KEY no configurada — sync inter-servicios deshabilitado');
    return;
  }

  log('info', `Iniciando sync inter-servicios (cada ${INTERVALO_MIN} min)`);
  await correrTodos();

  setInterval(() => {
    correrTodos().catch(err => log('error', `Tick fallido: ${err.message}`));
  }, INTERVALO_MIN * 60 * 1000);
}

async function correrTodos() {
  // Hub: usuarios + catalogo (unidades de negocio + familias)
  await sincronizarUsuariosDesdeHub().catch(err =>
    log('error', `sync usuarios: ${err.message}`));
  await sincronizarUnidadesNegocioDesdeHub().catch(err =>
    log('error', `sync unidades-negocio: ${err.message}`));

  // Equipos: asignacion equipo -> unidad de negocio
  await sincronizarEquiposDesdeEquipos().catch(err =>
    log('error', `sync equipos: ${err.message}`));
}
