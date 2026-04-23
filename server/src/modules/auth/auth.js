/**
 * auth.js
 *
 * Sistema de autenticacion para FleetOPS.
 * Roles:
 *   - admin:   acceso total a todo, todas las empresas
 *   - empresa: restringido a una empresa, sin acceso a Configuracion, no puede eliminar
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../database/database.js';

// ── SSO con Hub AB ─────────────────────────────────────────────────────────
// Parche 2026-04-23: aceptar JWTs emitidos por el Hub AB, además de los
// tokens locales de fleetops_usuarios (comportamiento aditivo, no destructivo).
const HUB_JWT_SECRET = process.env.HUB_JWT_SECRET || null;

function verifyHubToken(token) {
  if (!HUB_JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, HUB_JWT_SECRET);
    const rolEnFleetops = decoded?.permisos?.fleetops;
    if (!rolEnFleetops) return null;
    const rol = rolEnFleetops === 'admin' ? 'admin' : 'empresa';
    return {
      id:       decoded.userId,
      username: decoded.email,
      rol,
      empresa:  null,
      nombre:   decoded.email?.split('@')[0] || 'Hub user',
      _hub:     true,
    };
  } catch {
    return null;
  }
}


const JWT_SECRET = process.env.JWT_SECRET || 'fleetops-secret-key-change-in-production';
const JWT_EXPIRES = '24h';

function log(msg) {
  console.log(`[${new Date().toISOString()}] [Auth] ${msg}`);
}

// ── Inicializacion ──────────────────────────────────────────────────────────

/**
 * Crea el usuario admin por defecto si la tabla esta vacia.
 */
export async function initAuth() {
  try {
    const [rows] = await query('SELECT COUNT(*) AS total FROM fleetops_usuarios');
    if (rows[0].total === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await query(
        `INSERT INTO fleetops_usuarios (username, password_hash, nombre, rol, empresa, activo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['admin', hash, 'Administrador', 'admin', null, 1]
      );
      log('Usuario admin creado (password por defecto: admin123)');
    } else {
      log(`${rows[0].total} usuario(s) existente(s) — omitiendo creacion de admin`);
    }
  } catch (err) {
    // Si la tabla no existe todavia (sin MySQL), no es fatal
    log(`Advertencia al inicializar auth: ${err.message}`);
  }
}

// ── Login ───────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const [rows] = await query(
    'SELECT * FROM fleetops_usuarios WHERE username = ? AND activo = 1',
    [username]
  );

  if (rows.length === 0) {
    throw new Error('Usuario o password incorrecto');
  }

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new Error('Usuario o password incorrecto');
  }

  // Actualizar ultimo_login
  await query('UPDATE fleetops_usuarios SET ultimo_login = NOW() WHERE id = ?', [user.id]);

  const payload = {
    id: user.id,
    username: user.username,
    rol: user.rol,
    empresa: user.empresa,
    nombre: user.nombre,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      nombre: user.nombre,
      rol: user.rol,
      empresa: user.empresa,
    },
  };
}

// ── Token ───────────────────────────────────────────────────────────────────

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── Middleware Express ───────────────────────────────────────────────────────

/**
 * Middleware de autenticacion.
 * Acepta:
 *   - Header Authorization: Bearer <token>
 *   - Query param ?token=<token>  (para SSE)
 *   - Header X-Api-Key (backward compat — tratado como admin)
 *
 * Excepcion: POST /auth/login no requiere auth.
 */
export function authMiddleware(req, res, next) {
  // Saltar login — no requiere auth
  if (req.path === '/auth/login' && req.method === 'POST') {
    return next();
  }

  // 1. Intentar JWT desde Authorization header
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // 2. Fallback: query param ?token= (para SSE)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  // 3. Si hay token JWT, verificar (primero local, despues Hub AB)
  if (token) {
    try {
      const decoded = verifyToken(token);
      req.user = decoded;
      return next();
    } catch (errLocal) {
      const hubUser = verifyHubToken(token);
      if (hubUser) {
        req.user = hubUser;
        return next();
      }
      return res.status(401).json({ ok: false, error: 'Token invalido o expirado' });
    }
  }

  // 4. Fallback: X-Api-Key (backward compat)
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const key = req.headers['x-api-key'] || req.query.apikey;
    if (key === apiKey) {
      // Tratar como admin
      req.user = { id: 0, username: 'apikey', rol: 'admin', empresa: null, nombre: 'API Key' };
      return next();
    }
  }

  return res.status(401).json({ ok: false, error: 'Autenticacion requerida' });
}

/**
 * Requiere rol admin. Devuelve 403 si no es admin.
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  next();
}

/**
 * Para usuarios con rol empresa: fuerza req.query.empresa a su empresa asignada.
 * Para admin: pasa sin modificar (puede ver todo).
 */
export function requireEmpresa(req, res, next) {
  if (req.user && req.user.rol === 'empresa' && req.user.empresa) {
    req.query.empresa = req.user.empresa;
  }
  next();
}

// ── CRUD de usuarios (admin only) ──────────────────────────────────────────

export async function getUsuarios() {
  const [rows] = await query(
    `SELECT id, username, nombre, rol, empresa, activo, ultimo_login, creado_en
     FROM fleetops_usuarios
     ORDER BY creado_en DESC`
  );
  return rows;
}

export async function crearUsuario({ username, password, nombre, rol, empresa }) {
  if (!username || !password || !nombre || !rol) {
    throw new Error('Campos requeridos: username, password, nombre, rol');
  }

  if (rol === 'empresa' && !empresa) {
    throw new Error('Usuarios con rol "empresa" requieren una empresa asignada');
  }

  const hash = await bcrypt.hash(password, 10);

  try {
    const [result] = await query(
      `INSERT INTO fleetops_usuarios (username, password_hash, nombre, rol, empresa, activo)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [username, hash, nombre, rol, rol === 'admin' ? null : empresa]
    );

    return {
      id: result.insertId,
      username,
      nombre,
      rol,
      empresa: rol === 'admin' ? null : empresa,
      activo: 1,
    };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new Error(`El username "${username}" ya existe`);
    }
    throw err;
  }
}

export async function actualizarUsuario(id, { nombre, rol, empresa, activo }) {
  const fields = [];
  const values = [];

  if (nombre !== undefined) { fields.push('nombre = ?'); values.push(nombre); }
  if (rol !== undefined)    { fields.push('rol = ?');    values.push(rol); }
  if (empresa !== undefined){ fields.push('empresa = ?'); values.push(empresa); }
  if (activo !== undefined) { fields.push('activo = ?'); values.push(activo ? 1 : 0); }

  if (fields.length === 0) {
    throw new Error('No hay campos para actualizar');
  }

  values.push(id);
  await query(`UPDATE fleetops_usuarios SET ${fields.join(', ')} WHERE id = ?`, values);

  const [rows] = await query(
    'SELECT id, username, nombre, rol, empresa, activo, ultimo_login, creado_en FROM fleetops_usuarios WHERE id = ?',
    [id]
  );

  if (rows.length === 0) throw new Error('Usuario no encontrado');
  return rows[0];
}

export async function cambiarPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('La password debe tener al menos 4 caracteres');
  }

  const hash = await bcrypt.hash(newPassword, 10);
  const [result] = await query(
    'UPDATE fleetops_usuarios SET password_hash = ? WHERE id = ?',
    [hash, id]
  );

  if (result.affectedRows === 0) throw new Error('Usuario no encontrado');
  return { ok: true };
}

export async function eliminarUsuario(id) {
  // Soft delete: activo = 0
  const [result] = await query(
    'UPDATE fleetops_usuarios SET activo = 0 WHERE id = ?',
    [id]
  );

  if (result.affectedRows === 0) throw new Error('Usuario no encontrado');
  return { ok: true, id };
}
