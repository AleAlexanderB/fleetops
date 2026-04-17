/**
 * database.js
 * Pool de conexiones MySQL usando mysql2/promise.
 * 
 * TIMEZONE: '-03:00' (Argentina) para que los DATETIME de RedGPS
 * (que vienen en hora local argentina) se guarden y lean correctamente.
 */

import mysql from 'mysql2/promise';

let _pool = null;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Database] ${msg}`);
}

export async function initDatabase({ retries = 10, delayMs = 3000 } = {}) {
  if (_pool) return _pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    log('warn', 'DATABASE_URL no configurada — servidor arranca sin persistencia MySQL');
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const pool = mysql.createPool({
        uri:                url,
        waitForConnections: true,
        connectionLimit:    10,
        queueLimit:         0,
        // BUG-09 FIX: usar timezone de Argentina para que los DATETIME
        // de RedGPS (hora local) se guarden y lean sin conversión incorrecta
        timezone:           '-03:00',
        charset:            'utf8mb4',
      });

      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();

      _pool = pool;
      log('info', `Pool MySQL inicializado correctamente (timezone: -03:00 Argentina, intento ${attempt}/${retries})`);
      return _pool;
    } catch (err) {
      log('warn', `Intento ${attempt}/${retries} fallido: ${err.message}`);
      if (attempt < retries) {
        log('info', `Reintentando en ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  log('error', 'No se pudo conectar a MySQL después de todos los intentos');
  log('warn', 'Continuando sin persistencia MySQL');
  _pool = null;
  return null;
}

export function db()           { return _pool; }
export function isConnected()  { return !!_pool; }

export async function query(sql, params = []) {
  if (!_pool) throw new Error('Sin conexión a la base de datos');
  return _pool.execute(sql, params);
}

export async function getConnection() {
  if (!_pool) throw new Error('Sin conexión a la base de datos');
  return _pool.getConnection();
}

export async function transaction(fn) {
  const conn = await getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
