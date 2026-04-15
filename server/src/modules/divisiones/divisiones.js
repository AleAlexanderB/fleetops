/**
 * divisiones.js
 *
 * Asignación equipo → división + subgrupo.
 * Clave: codigo del equipo (A021, K006...) — consistente con el resto del sistema.
 * Persiste en MySQL (tabla fleetops_divisiones).
 * Fallback a divisiones.json si no hay DB disponible.
 *
 * Configuración de divisiones y subdivisiones: dinámica desde DB
 * (tabla fleetops_config_divisiones). Fallback a DEFAULT_DIVISIONES.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../../database/database.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE  = path.join(__dirname, '../../../../data/divisiones.json');
const CONFIG_FILE = path.join(__dirname, '../../../../data/divisiones_config.json');

const DEFAULT_DIVISIONES = [
  'Hormigón', 'Agregados', 'Premoldeados',
  'Obras', 'Logística', 'Corralón', 'Taller',
];

// Multi-empresa: config por empresa
// _divisionesPorEmpresa = { 'Corralon el Mercado': ['Hormigón', ...], 'VIAP': [...] }
// _subdivisionesPorEmpresa = { 'Corralon el Mercado': { 'Hormigón': ['Bombas'] }, 'VIAP': { ... } }
let _divisionesPorEmpresa    = {};   // { [empresa]: string[] }
let _subdivisionesPorEmpresa = {};   // { [empresa]: { [division]: string[] } }

// Helpers para acceso por empresa (con fallback a defaults)
function _getDivisiones(empresa) {
  if (empresa && _divisionesPorEmpresa[empresa]) return _divisionesPorEmpresa[empresa];
  // Si no hay empresa especifica, devolver todas las divisiones unicas
  const todas = new Set();
  for (const divs of Object.values(_divisionesPorEmpresa)) {
    for (const d of divs) todas.add(d);
  }
  return todas.size > 0 ? [...todas] : [...DEFAULT_DIVISIONES];
}

function _getSubdivisiones(empresa) {
  if (empresa && _subdivisionesPorEmpresa[empresa]) return _subdivisionesPorEmpresa[empresa];
  // Merge de todas las empresas
  const merged = {};
  for (const subs of Object.values(_subdivisionesPorEmpresa)) {
    for (const [div, arr] of Object.entries(subs)) {
      if (!merged[div]) merged[div] = new Set();
      for (const s of arr) merged[div].add(s);
    }
  }
  const result = {};
  for (const [div, set] of Object.entries(merged)) {
    result[div] = [...set];
  }
  return result;
}

let _cache = {};  // { [codigo]: { division, subgrupo } }

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Divisiones] ${msg}`);
}

// ── JSON fallback (asignaciones equipo → división) ───────────────────────────

function cargarDesdeJSON() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      _cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      log('info', `Fallback JSON: ${Object.keys(_cache).length} asignaciones`);
    }
  } catch (err) {
    log('warn', `No se pudo leer divisiones.json: ${err.message}`);
    _cache = {};
  }
}

function guardarEnJSON() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(_cache, null, 2), 'utf-8');
  } catch (err) {
    log('warn', `No se pudo escribir divisiones.json: ${err.message}`);
  }
}

// ── JSON fallback (config de divisiones) ─────────────────────────────────────

function cargarConfigDesdeJSON() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (Array.isArray(data.divisiones) && data.divisiones.length > 0) {
        _divisiones = data.divisiones;
      }
      if (data.subdivisiones && typeof data.subdivisiones === 'object') {
        _subdivisiones = data.subdivisiones;
      }
      log('info', `Config JSON: ${_divisiones.length} divisiones cargadas`);
    }
  } catch (err) {
    log('warn', `No se pudo leer divisiones_config.json: ${err.message}`);
  }
}

function guardarConfigEnJSON() {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      divisiones: _divisiones,
      subdivisiones: _subdivisiones,
    }, null, 2), 'utf-8');
  } catch (err) {
    log('warn', `No se pudo escribir divisiones_config.json: ${err.message}`);
  }
}

// ── MySQL ─────────────────────────────────────────────────────────────────────

async function cargarDesdeDB() {
  const pool = db();
  if (!pool) return false;
  try {
    const [rows] = await pool.execute(
      'SELECT codigo_equipo, patente, division, subgrupo FROM fleetops_divisiones'
    );
    _cache = {};
    for (const row of rows) {
      const key = row.codigo_equipo || row.patente;
      if (key) _cache[key] = { division: row.division, subgrupo: row.subgrupo };
    }
    log('info', `MySQL: ${rows.length} asignaciones cargadas`);
    return true;
  } catch (err) {
    log('error', `Error al cargar divisiones: ${err.message}`);
    return false;
  }
}

async function cargarConfigDesdeBD() {
  const pool = db();
  if (!pool) return false;
  try {
    const [rows] = await pool.execute(
      'SELECT empresa, division, subdivisiones FROM fleetops_config_divisiones ORDER BY empresa, id'
    );
    if (rows.length > 0) {
      _divisionesPorEmpresa = {};
      _subdivisionesPorEmpresa = {};
      for (const row of rows) {
        const emp = row.empresa || '_default';
        if (!_divisionesPorEmpresa[emp]) {
          _divisionesPorEmpresa[emp] = [];
          _subdivisionesPorEmpresa[emp] = {};
        }
        _divisionesPorEmpresa[emp].push(row.division);
        let subs = [];
        if (row.subdivisiones) {
          try { subs = typeof row.subdivisiones === 'string' ? JSON.parse(row.subdivisiones) : row.subdivisiones; } catch { subs = []; }
        }
        _subdivisionesPorEmpresa[emp][row.division] = Array.isArray(subs) ? subs : [];
      }
      const empresas = Object.keys(_divisionesPorEmpresa);
      log('info', `MySQL config: ${rows.length} divisiones cargadas (${empresas.length} empresas: ${empresas.join(', ')})`);
      return true;
    }
    log('info', 'MySQL config: tabla vacía, usando defaults');
    return false;
  } catch (err) {
    log('warn', `No se pudo cargar config divisiones de DB: ${err.message}`);
    return false;
  }
}

async function upsertEnDB(codigo, division, subgrupo) {
  const pool = db();
  if (!pool) return false;
  try {
    await pool.execute(
      `INSERT INTO fleetops_divisiones (codigo_equipo, patente, division, subgrupo)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         division       = VALUES(division),
         subgrupo       = VALUES(subgrupo),
         actualizado_en = CURRENT_TIMESTAMP`,
      [codigo, codigo, division, subgrupo ?? null]
    );
    return true;
  } catch (err) {
    log('error', `Error al guardar división: ${err.message}`);
    return false;
  }
}

async function deleteEnDB(codigo) {
  const pool = db();
  if (!pool) return false;
  try {
    await pool.execute(
      'DELETE FROM fleetops_divisiones WHERE codigo_equipo = ? OR patente = ?',
      [codigo, codigo]
    );
    return true;
  } catch (err) {
    log('error', `Error al eliminar división: ${err.message}`);
    return false;
  }
}

// ── Helpers de persistencia para config de divisiones ─────────────────────────

async function persistirConfigDivision(empresa, nombre, subdivisiones) {
  const pool = db();
  if (pool) {
    try {
      await pool.execute(
        `INSERT INTO fleetops_config_divisiones (empresa, division, subdivisiones)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE subdivisiones = VALUES(subdivisiones)`,
        [empresa, nombre, JSON.stringify(subdivisiones)]
      );
      return true;
    } catch (err) {
      log('error', `Error al persistir config división: ${err.message}`);
    }
  }
  guardarConfigEnJSON();
  return false;
}

async function eliminarConfigDivisionDB(empresa, nombre) {
  const pool = db();
  if (pool) {
    try {
      await pool.execute(
        'DELETE FROM fleetops_config_divisiones WHERE empresa = ? AND division = ?',
        [empresa, nombre]
      );
      return true;
    } catch (err) {
      log('error', `Error al eliminar config división: ${err.message}`);
    }
  }
  guardarConfigEnJSON();
  return false;
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function initDivisiones() {
  log('info', 'Iniciando módulo de divisiones...');

  // Cargar config de divisiones (DB primero, luego JSON, luego defaults)
  const configFromDB = await cargarConfigDesdeBD();
  if (!configFromDB) {
    cargarConfigDesdeJSON();
    // Fallback: poner todo en _default
    if (Object.keys(_divisionesPorEmpresa).length === 0) {
      _divisionesPorEmpresa['_default'] = [...DEFAULT_DIVISIONES];
      _subdivisionesPorEmpresa['_default'] = {};
      for (const d of DEFAULT_DIVISIONES) {
        _subdivisionesPorEmpresa['_default'][d] = [];
      }
    }
  }

  // Cargar asignaciones equipo → división
  const fromDB = await cargarDesdeDB();
  if (!fromDB) cargarDesdeJSON();
}

/** Obtener división por codigo del equipo */
export function getDivision(codigo) {
  return _cache[codigo] || null;
}

/** Asignar o quitar división a un equipo por su código */
export async function setDivision(codigo, division, subgrupo = null, empresa = null) {
  if (!codigo) throw new Error('Código de equipo requerido');

  const divValidas = _getDivisiones(empresa);
  if (division && !divValidas.includes(division)) {
    throw new Error(`División inválida: "${division}". Válidas: ${divValidas.join(', ')}`);
  }

  if (!division) {
    delete _cache[codigo];
    await deleteEnDB(codigo);
  } else {
    _cache[codigo] = { division, subgrupo: subgrupo || null };
    const ok = await upsertEnDB(codigo, division, subgrupo);
    if (!ok) guardarEnJSON();
  }

  log('info', `Asignación: ${codigo} → ${division || '(sin división)'}${subgrupo ? ' / ' + subgrupo : ''}`);
  return _cache[codigo] || null;
}

export function getAllDivisiones() {
  return { ..._cache };
}

export function getDivisionesValidas(empresa = null) {
  const divisiones = _getDivisiones(empresa);
  const subdivConfig = _getSubdivisiones(empresa);

  // Backward compat: subgruposObras sigue existiendo como alias
  const subgruposObras = [...new Set(
    Object.values(_cache)
      .filter(v => v.division === 'Obras' && v.subgrupo)
      .map(v => v.subgrupo)
  )];

  // Construir subdivisiones completas: config + subgrupos en uso
  const subdivisiones = {};
  for (const div of divisiones) {
    const configuradas = subdivConfig[div] || [];
    const enUso = [...new Set(
      Object.values(_cache)
        .filter(v => v.division === div && v.subgrupo)
        .map(v => v.subgrupo)
    )];
    subdivisiones[div] = [...new Set([...configuradas, ...enUso])];
  }

  return { divisiones, subdivisiones, subgruposObras };
}

// ── Gestión dinámica de divisiones ───────────────────────────────────────────

/** Agregar una nueva división */
export async function agregarDivision(nombre, empresa) {
  if (!nombre || typeof nombre !== 'string') throw new Error('Nombre de división requerido');
  if (!empresa) throw new Error('Empresa requerida');
  nombre = nombre.trim();
  if (nombre.length === 0) throw new Error('Nombre de división requerido');
  if (nombre.length > 50) throw new Error('El nombre de la división no puede superar los 50 caracteres');

  if (!_divisionesPorEmpresa[empresa]) {
    _divisionesPorEmpresa[empresa] = [];
    _subdivisionesPorEmpresa[empresa] = {};
  }
  if (_divisionesPorEmpresa[empresa].includes(nombre)) {
    throw new Error(`La división "${nombre}" ya existe en ${empresa}`);
  }

  _divisionesPorEmpresa[empresa].push(nombre);
  _subdivisionesPorEmpresa[empresa][nombre] = [];

  await persistirConfigDivision(empresa, nombre, []);
  log('info', `[${empresa}] División agregada: "${nombre}"`);

  return { divisiones: _divisionesPorEmpresa[empresa], subdivisiones: _subdivisionesPorEmpresa[empresa] };
}

/** Eliminar una división (solo si no tiene equipos asignados) */
export async function eliminarDivision(nombre, empresa) {
  if (!nombre || typeof nombre !== 'string') throw new Error('Nombre de división requerido');
  if (!empresa) throw new Error('Empresa requerida');
  nombre = nombre.trim();

  const divs = _divisionesPorEmpresa[empresa] || [];
  if (!divs.includes(nombre)) {
    throw new Error(`La división "${nombre}" no existe en ${empresa}`);
  }

  // Nota: la verificación de equipos asignados se hace en el router,
  // filtrando solo los equipos de la empresa correspondiente.

  _divisionesPorEmpresa[empresa] = divs.filter(d => d !== nombre);
  if (_subdivisionesPorEmpresa[empresa]) delete _subdivisionesPorEmpresa[empresa][nombre];

  await eliminarConfigDivisionDB(empresa, nombre);
  log('info', `[${empresa}] División eliminada: "${nombre}"`);

  return { divisiones: _divisionesPorEmpresa[empresa], subdivisiones: _subdivisionesPorEmpresa[empresa] || {} };
}

/** Agregar una subdivisión a una división */
export async function agregarSubdivision(division, nombre, empresa) {
  if (!division || typeof division !== 'string') throw new Error('Nombre de división requerido');
  if (!nombre || typeof nombre !== 'string') throw new Error('Nombre de subdivisión requerido');
  if (!empresa) throw new Error('Empresa requerida');
  division = division.trim();
  nombre = nombre.trim();

  const divs = _divisionesPorEmpresa[empresa] || [];
  if (!divs.includes(division)) {
    throw new Error(`La división "${division}" no existe en ${empresa}`);
  }
  if (nombre.length === 0) throw new Error('Nombre de subdivisión requerido');
  if (nombre.length > 50) throw new Error('El nombre no puede superar los 50 caracteres');

  if (!_subdivisionesPorEmpresa[empresa]) _subdivisionesPorEmpresa[empresa] = {};
  if (!_subdivisionesPorEmpresa[empresa][division]) _subdivisionesPorEmpresa[empresa][division] = [];
  if (_subdivisionesPorEmpresa[empresa][division].includes(nombre)) {
    throw new Error(`La subdivisión "${nombre}" ya existe en "${division}"`);
  }

  _subdivisionesPorEmpresa[empresa][division].push(nombre);

  await persistirConfigDivision(empresa, division, _subdivisionesPorEmpresa[empresa][division]);
  log('info', `[${empresa}] Subdivisión agregada: "${division}" → "${nombre}"`);

  return { division, subdivisiones: _subdivisionesPorEmpresa[empresa][division] };
}

/** Eliminar una subdivisión de una división */
export async function eliminarSubdivision(division, nombre, empresa) {
  if (!division || typeof division !== 'string') throw new Error('Nombre de división requerido');
  if (!nombre || typeof nombre !== 'string') throw new Error('Nombre de subdivisión requerido');
  if (!empresa) throw new Error('Empresa requerida');
  division = division.trim();
  nombre = nombre.trim();

  const divs = _divisionesPorEmpresa[empresa] || [];
  if (!divs.includes(division)) {
    throw new Error(`La división "${division}" no existe en ${empresa}`);
  }

  const subs = _subdivisionesPorEmpresa[empresa]?.[division] || [];
  if (!subs.includes(nombre)) {
    throw new Error(`La subdivisión "${nombre}" no existe en "${division}"`);
  }

  _subdivisionesPorEmpresa[empresa][division] = subs.filter(s => s !== nombre);

  await persistirConfigDivision(empresa, division, _subdivisionesPorEmpresa[empresa][division]);
  log('info', `[${empresa}] Subdivisión eliminada: "${division}" → "${nombre}"`);

  return { division, subdivisiones: _subdivisionesPorEmpresa[empresa][division] };
}
