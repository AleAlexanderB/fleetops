/**
 * tarifas.js
 * Gestión de tarifas por ruta (origen → destino → precio combustible).
 * Se usa para liquidación de choferes.
 */

import { query } from '../../database/database.js';

// Cache en memoria: "ORIGEN|DESTINO" → precio
let _tarifas = new Map();

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Tarifas] ${msg}`);
}

function normNombre(nombre) {
  return (nombre || '').toUpperCase().trim().replace(/\s+/g, ' ');
}

/**
 * Carga tarifas desde MySQL al cache.
 */
export async function initTarifas() {
  try {
    const [rows] = await query('SELECT * FROM fleetops_tarifas_rutas WHERE activo = 1');
    _tarifas.clear();
    for (const r of rows) {
      const key = `${normNombre(r.origen)}|${normNombre(r.destino)}`;
      _tarifas.set(key, {
        id:      r.id,
        origen:  r.origen,
        destino: r.destino,
        precio:  parseFloat(r.precio),
        notas:   r.notas,
      });
    }
    log('info', `${_tarifas.size} tarifas cargadas`);
  } catch (err) {
    log('error', `Error al cargar tarifas: ${err.message}`);
  }
}

/**
 * Busca la tarifa para una ruta dada.
 * Intenta match exacto y luego parcial (contiene).
 */
export function buscarTarifa(origen, destino) {
  if (!origen || !destino) return null;
  const o = normNombre(origen);
  const d = normNombre(destino);

  // Exacto
  const exacto = _tarifas.get(`${o}|${d}`);
  if (exacto) return exacto;

  // Parcial: buscar si el nombre de geocerca contiene el nombre de la tarifa o viceversa
  for (const [, tarifa] of _tarifas) {
    const to = normNombre(tarifa.origen);
    const td = normNombre(tarifa.destino);
    if ((o.includes(to) || to.includes(o)) && (d.includes(td) || td.includes(d))) {
      return tarifa;
    }
  }

  return null;
}

/**
 * Retorna todas las tarifas.
 */
export function getTarifas() {
  return [..._tarifas.values()];
}

/**
 * CRUD: agregar o actualizar tarifa.
 */
export async function upsertTarifa({ origen, destino, precio, notas }) {
  const o = normNombre(origen);
  const d = normNombre(destino);
  if (!o || !d) throw new Error('Origen y destino son requeridos');
  if (precio == null || isNaN(precio)) throw new Error('Precio inválido');

  try {
    const [result] = await query(
      `INSERT INTO fleetops_tarifas_rutas (origen, destino, precio, notas)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE precio = VALUES(precio), notas = VALUES(notas), activo = 1`,
      [o, d, precio, notas || null]
    );

    const id = result.insertId || result.affectedRows;
    const tarifa = { id, origen: o, destino: d, precio: parseFloat(precio), notas: notas || null };
    _tarifas.set(`${o}|${d}`, tarifa);
    log('info', `Tarifa guardada: ${o} → ${d} = $${precio}`);
    return tarifa;
  } catch (err) {
    log('error', `Error guardando tarifa: ${err.message}`);
    throw err;
  }
}

/**
 * Eliminar (desactivar) tarifa.
 */
export async function eliminarTarifa(id) {
  try {
    await query('UPDATE fleetops_tarifas_rutas SET activo = 0 WHERE id = ?', [id]);
    // Remover del cache
    for (const [key, t] of _tarifas) {
      if (t.id === id) { _tarifas.delete(key); break; }
    }
    log('info', `Tarifa ${id} eliminada`);
  } catch (err) {
    log('error', `Error eliminando tarifa: ${err.message}`);
    throw err;
  }
}
