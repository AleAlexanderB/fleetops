/**
 * equipos_lookup.js
 *
 * Lookup IMEI → { codigo, patente, cliente, marca, modelo }
 * Fuente: data/equipos_redgps.json generado desde el reporte RedGPS.
 * Se carga al iniciar el proceso; restart para refrescar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, '../../../data/equipos_redgps.json');

let byImei = new Map();
let byCodigo = new Map();
let byPatente = new Map();
let meta = null;

export function loadEquiposLookup() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const { meta: m, equipos } = JSON.parse(raw);
    byImei = new Map();
    byCodigo = new Map();
    byPatente = new Map();
    for (const e of equipos) {
      if (e.imei)    byImei.set(e.imei, e);
      if (e.codigo)  byCodigo.set(e.codigo.toUpperCase(), e);
      if (e.patente) byPatente.set(e.patente.toUpperCase(), e);
    }
    meta = m;
    console.log(`[EquiposLookup] Cargados ${equipos.length} equipos (IMEI=${byImei.size} COD=${byCodigo.size} PAT=${byPatente.size})`);
    return true;
  } catch (err) {
    console.error(`[EquiposLookup] Error cargando ${DATA_PATH}: ${err.message}`);
    return false;
  }
}

export function getByImei(imei) {
  if (!imei) return null;
  return byImei.get(String(imei).trim()) || null;
}

export function getByCodigo(codigo) {
  if (!codigo) return null;
  return byCodigo.get(String(codigo).trim().toUpperCase()) || null;
}

export function getByPatente(patente) {
  if (!patente) return null;
  return byPatente.get(String(patente).trim().toUpperCase()) || null;
}

export function getLookupMeta() {
  return { ...meta, size: byImei.size };
}
