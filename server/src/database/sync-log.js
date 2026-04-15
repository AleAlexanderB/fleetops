/**
 * sync-log.js
 *
 * Escribe en fleetops_sync_log el resultado de cada polling a RedGPS.
 * Si no hay MySQL, es un no-op silencioso.
 * Útil para diagnosticar problemas de conectividad y auditar el historial de syncs.
 */

import { db } from './database.js';

export async function logSync({ endpoint, resultado, registrosProcesados, mensajeError, duracionMs }) {
  const pool = db();
  if (!pool) return;

  try {
    await pool.execute(
      `INSERT INTO fleetops_sync_log
         (endpoint, resultado, registros_procesados, mensaje_error, duracion_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [
        endpoint,
        resultado                       || 'ok',
        registrosProcesados             ?? null,
        mensajeError                    ?? null,
        duracionMs                      ?? null,
      ]
    );
  } catch {
    // Nunca lanzar — el log es opcional, no puede romper el flujo
  }
}

/**
 * Wrapper que ejecuta una función de sync y registra el resultado.
 *
 * @param {string}   endpoint - nombre del endpoint RedGPS
 * @param {Function} fn       - async function que hace el sync, debe retornar array
 */
export async function withSyncLog(endpoint, fn) {
  const t0 = Date.now();
  try {
    const resultado = await fn();
    const n = Array.isArray(resultado) ? resultado.length : null;
    await logSync({
      endpoint,
      resultado:           'ok',
      registrosProcesados: n,
      duracionMs:          Date.now() - t0,
    });
    return resultado;
  } catch (err) {
    await logSync({
      endpoint,
      resultado:    'error',
      mensajeError: err.message?.slice(0, 500),
      duracionMs:   Date.now() - t0,
    });
    throw err;
  }
}
