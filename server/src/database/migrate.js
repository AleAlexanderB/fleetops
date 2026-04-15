/**
 * migrate.js
 * Corre TODOS los archivos migration_vN.sql en orden al arrancar.
 * Idempotente — usa IF NOT EXISTS, se puede correr N veces sin daño.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './database.js';

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Migrate] ${msg}`);
}

/**
 * Divide un archivo SQL en statements individuales.
 * Elimina comentarios de línea (--) y de bloque (* *) antes de dividir por ;
 * para evitar que un punto y coma dentro de un comentario corte el statement.
 */
function parseSql(sql) {
  // 1. Eliminar comentarios de bloque /* ... */
  let clean = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');

  // 2. Eliminar comentarios de línea -- hasta fin de línea
  clean = clean.replace(/--[^\n]*/g, '');

  // 3. Dividir por ; y limpiar espacios
  return clean
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

async function runFile(pool, filePath) {
  const name  = path.basename(filePath);
  const sql   = fs.readFileSync(filePath, 'utf-8');
  const stmts = parseSql(sql);
  let ok = 0, skipped = 0, errors = 0;

  log('info', `[${name}] ${stmts.length} statements a ejecutar`);

  for (const stmt of stmts) {
    // Saltar SELECTs informativos
    if (/^SELECT\b/i.test(stmt)) { skipped++; continue; }

    try {
      await pool.execute(stmt);
      ok++;
    } catch (err) {
      // Errores de "ya existe" son esperados en re-runs — ignorar
      const ignorables = [
        'ER_TABLE_EXISTS_ERROR',
        'ER_DUP_KEYNAME',
        'ER_DUP_FIELDNAME',
        'ER_CANT_DROP_FIELD_OR_KEY',
        'ER_DUP_ENTRY',
      ];
      if (ignorables.includes(err.code)) {
        skipped++;
      } else {
        log('error', `[${name}] ${err.message} | SQL: ${stmt.substring(0, 100)}`);
        errors++;
      }
    }
  }

  const status = errors === 0
    ? `OK — ${ok} ejecutados, ${skipped} omitidos`
    : `${errors} ERRORES, ${ok} OK, ${skipped} omitidos`;
  log(errors === 0 ? 'info' : 'warn', `[${name}] ${status}`);
  return errors === 0;
}

export async function runMigrations() {
  const pool = db();
  if (!pool) {
    log('warn', 'Sin conexión MySQL — omitiendo migraciones');
    return false;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => path.join(MIGRATIONS_DIR, f));

  if (files.length === 0) {
    log('warn', 'No se encontraron archivos .sql en migrations/');
    return false;
  }

  log('info', `Migraciones a ejecutar: ${files.map(f => path.basename(f)).join(', ')}`);

  let allOk = true;
  for (const f of files) {
    const ok = await runFile(pool, f);
    if (!ok) allOk = false;
  }

  log('info', allOk ? '✓ Todas las migraciones completadas' : '⚠ Migraciones completadas con errores');
  return allOk;
}
