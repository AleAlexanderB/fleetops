/**
 * alertas.js
 * Módulo de alertas — persiste y consulta alertas recibidas por webhook de RedGPS.
 */

import { query } from '../../database/database.js';

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Alertas] ${msg}`);
}

// Tipos de alerta conocidos
const TIPOS_ALERTA = {
  velocidad:        'Exceso de velocidad',
  ralenti:          'Ralentí',
  combustible:      'Combustible',
  ignicion_on:      'Ignición ON',
  ignicion_off:     'Ignición OFF',
  panico:           'Pánico / SOS',
  bateria:          'Batería baja',
  desconexion:      'Desconexión GPS',
  otro:             'Otra alerta',
};

/**
 * Clasifica la descripcion de RedGPS en un tipo de alerta interno.
 */
export function clasificarAlerta(descripcion) {
  const d = (descripcion || '').toLowerCase();

  if (d.includes('ingresa') || d.includes('entrada') || d.includes('entra a')) return 'geocerca_ingreso';
  if (d.includes('sale') || d.includes('salida') || d.includes('salio'))       return 'geocerca_salida';
  if (d.includes('velocidad') || d.includes('speed') || d.includes('exceso')) return 'velocidad';
  if (d.includes('ralenti') || d.includes('ralentí') || d.includes('idle'))   return 'ralenti';
  if (d.includes('combustible') || d.includes('fuel') || d.includes('tanque') || d.includes('nafta') || d.includes('gasoil')) return 'combustible';
  if (d.includes('ignicion on') || d.includes('ignición on') || d.includes('motor encendido') || d.includes('ignition on')) return 'ignicion_on';
  if (d.includes('ignicion off') || d.includes('ignición off') || d.includes('motor apagado') || d.includes('ignition off')) return 'ignicion_off';
  if (d.includes('panico') || d.includes('pánico') || d.includes('sos') || d.includes('panic')) return 'panico';
  if (d.includes('bateria') || d.includes('batería') || d.includes('battery')) return 'bateria';
  if (d.includes('desconex') || d.includes('disconnect') || d.includes('sin señal')) return 'desconexion';

  return 'otro';
}

/**
 * Inserta una alerta en la base de datos.
 */
export async function guardarAlerta({
  tipo, codigoEquipo, patente, etiqueta, empresa, division,
  descripcion, geocerca, latitud, longitud, velocidad, conductor,
  timestampAlerta,
}) {
  try {
    // Convertir ISO 8601 (2026-04-14T15:03:47.000Z) → MySQL DATETIME (2026-04-14 15:03:47)
    let tsMysql = timestampAlerta;
    if (typeof tsMysql === 'string' && tsMysql.includes('T')) {
      tsMysql = tsMysql.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
    }
    const [result] = await query(
      `INSERT INTO fleetops_alertas
         (tipo, codigo_equipo, patente, etiqueta, empresa, division,
          descripcion, geocerca, latitud, longitud, velocidad, conductor,
          timestamp_alerta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tipo, codigoEquipo || null, patente || null, etiqueta || null,
        empresa || null, division || null,
        descripcion || null, geocerca || null,
        latitud || null, longitud || null, velocidad || null, conductor || null,
        tsMysql,
      ]
    );
    log('info', `Alerta guardada: id=${result.insertId} tipo=${tipo} equipo=${codigoEquipo}`);
    return result.insertId;
  } catch (err) {
    log('error', `Error al guardar alerta: ${err.message}`);
    throw err;
  }
}

/**
 * Consulta alertas con filtros y paginación.
 */
export async function getAlertas({
  tipo, codigoEquipo, empresa, division, geocerca,
  desde, hasta, leida,
  page = 1, pageSize = 50,
} = {}) {
  const where = [];
  const params = [];

  if (tipo) {
    where.push('tipo = ?');
    params.push(tipo);
  }
  if (codigoEquipo) {
    where.push('codigo_equipo = ?');
    params.push(codigoEquipo);
  }
  if (empresa) {
    where.push('empresa = ?');
    params.push(empresa);
  }
  if (division) {
    where.push('division = ?');
    params.push(division);
  }
  if (geocerca) {
    where.push('geocerca LIKE ?');
    params.push(`%${geocerca}%`);
  }
  if (desde) {
    where.push('timestamp_alerta >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('timestamp_alerta <= ?');
    params.push(`${hasta} 23:59:59`);
  }
  if (leida !== undefined && leida !== null && leida !== '') {
    where.push('leida = ?');
    params.push(Number(leida));
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;

  // Count total
  const [countRows] = await query(
    `SELECT COUNT(*) as total FROM fleetops_alertas ${whereClause}`,
    params
  );
  const total = countRows[0].total;

  // Fetch page
  const [rows] = await query(
    `SELECT * FROM fleetops_alertas ${whereClause}
     ORDER BY timestamp_alerta DESC
     LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`,
    params
  );

  return {
    ok: true,
    data: rows.map(r => ({
      id:              r.id,
      tipo:            r.tipo,
      tipoLabel:       TIPOS_ALERTA[r.tipo] || r.tipo,
      codigoEquipo:    r.codigo_equipo,
      patente:         r.patente,
      etiqueta:        r.etiqueta,
      empresa:         r.empresa,
      division:        r.division,
      descripcion:     r.descripcion,
      geocerca:        r.geocerca,
      latitud:         r.latitud ? parseFloat(r.latitud) : null,
      longitud:        r.longitud ? parseFloat(r.longitud) : null,
      velocidad:       r.velocidad ? parseFloat(r.velocidad) : null,
      conductor:       r.conductor,
      timestampAlerta: r.timestamp_alerta,
      creadoEn:        r.creado_en,
      leida:           !!r.leida,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Resumen de alertas del día.
 */
export async function getResumenAlertas({ empresa, desde, hasta } = {}) {
  const where = [];
  const params = [];

  if (desde) {
    where.push('timestamp_alerta >= ?');
    params.push(desde);
  } else {
    // Por defecto: hoy
    where.push('DATE(timestamp_alerta) = CURDATE()');
  }
  if (hasta) {
    where.push('timestamp_alerta <= ?');
    params.push(`${hasta} 23:59:59`);
  }
  if (empresa) {
    where.push('empresa = ?');
    params.push(empresa);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await query(
    `SELECT tipo, COUNT(*) as cantidad
     FROM fleetops_alertas ${whereClause}
     GROUP BY tipo
     ORDER BY cantidad DESC`,
    params
  );

  const total = rows.reduce((sum, r) => sum + r.cantidad, 0);
  const noLeidas = await query(
    `SELECT COUNT(*) as cnt FROM fleetops_alertas ${whereClause} ${where.length > 0 ? 'AND' : 'WHERE'} leida = 0`,
    params
  ).then(([r]) => r[0].cnt).catch(() => 0);

  return {
    total,
    noLeidas,
    porTipo: rows.map(r => ({
      tipo:      r.tipo,
      tipoLabel: TIPOS_ALERTA[r.tipo] || r.tipo,
      cantidad:  r.cantidad,
    })),
  };
}

/**
 * Marcar alertas como leídas.
 */
export async function marcarLeidas(ids) {
  if (!ids || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const [result] = await query(
    `UPDATE fleetops_alertas SET leida = 1 WHERE id IN (${placeholders})`,
    ids
  );
  return result.affectedRows;
}

/**
 * Marcar TODAS las alertas como leídas.
 */
export async function marcarTodasLeidas() {
  const [result] = await query(
    `UPDATE fleetops_alertas SET leida = 1 WHERE leida = 0`
  );
  return result.affectedRows;
}

/**
 * Ranking de vehiculos con mas alertas (top 10).
 */
export async function getRankingAlertas({ empresa, desde, hasta, tipo } = {}) {
  const where = [];
  const params = [];

  if (empresa) {
    where.push('empresa = ?');
    params.push(empresa);
  }
  if (desde) {
    where.push('timestamp_alerta >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('timestamp_alerta <= ?');
    params.push(`${hasta} 23:59:59`);
  }
  if (tipo) {
    where.push('tipo = ?');
    params.push(tipo);
  }

  where.push('codigo_equipo IS NOT NULL');
  const whereClause = `WHERE ${where.join(' AND ')}`;

  // Top 10 vehiculos por cantidad de alertas, con desglose por tipo
  const [rows] = await query(
    `SELECT codigo_equipo, etiqueta, empresa, tipo, COUNT(*) as cantidad
     FROM fleetops_alertas
     ${whereClause}
     GROUP BY codigo_equipo, etiqueta, empresa, tipo
     ORDER BY codigo_equipo`,
    params
  );

  // Agrupar por vehiculo
  const vehiculoMap = new Map();
  for (const row of rows) {
    const key = row.codigo_equipo;
    if (!vehiculoMap.has(key)) {
      vehiculoMap.set(key, {
        codigoEquipo: row.codigo_equipo,
        etiqueta:     row.etiqueta || row.codigo_equipo,
        empresa:      row.empresa,
        totalAlertas: 0,
        porTipo:      {},
      });
    }
    const entry = vehiculoMap.get(key);
    entry.totalAlertas += row.cantidad;
    entry.porTipo[row.tipo] = (entry.porTipo[row.tipo] || 0) + row.cantidad;
  }

  // Ordenar por totalAlertas desc y tomar top 10
  const ranking = [...vehiculoMap.values()]
    .sort((a, b) => b.totalAlertas - a.totalAlertas)
    .slice(0, 10);

  return ranking;
}

export { TIPOS_ALERTA };
