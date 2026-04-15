/**
 * empresas.js
 *
 * Configuracion multi-empresa para FleetOPS.
 * Cada empresa tiene su propia cuenta RedGPS (apikey, usuario, password)
 * y su propia instancia de TokenManager + RedGPSClient.
 *
 * Configuracion via .env:
 *   EMPRESA_1_NOMBRE=Corralon el Mercado
 *   EMPRESA_1_APIKEY=xxx
 *   EMPRESA_1_USERNAME=xxx
 *   EMPRESA_1_PASSWORD=xxx
 *   ...
 *   EMPRESA_N_...
 *
 * Fallback: si no hay EMPRESA_N_, usa las variables legacy REDGPS_APIKEY etc.
 */

import { TokenManager } from './token-manager.js';
import { RedGPSClient }  from './redgps-client.js';

const REDGPS_BASE_URL = process.env.REDGPS_BASE_URL || 'http://api.service24gps.com/api/v1';

/** @type {{ nombre: string, client: RedGPSClient, tokenManager: TokenManager }[]} */
let _empresas = [];

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Empresas] ${msg}`);
}

/**
 * Parsea las variables de entorno y crea instancias de TokenManager + RedGPSClient
 * para cada empresa configurada.
 */
export function initEmpresas() {
  const empresas = [];

  // Buscar EMPRESA_N_ en env (hasta 20 empresas)
  for (let i = 1; i <= 20; i++) {
    const nombre   = process.env[`EMPRESA_${i}_NOMBRE`];
    if (!nombre) continue;

    const apikey   = process.env[`EMPRESA_${i}_APIKEY`];
    const username = process.env[`EMPRESA_${i}_USERNAME`];
    const password = process.env[`EMPRESA_${i}_PASSWORD`];

    if (!apikey || !username || !password) {
      log('warn', `Empresa ${i} (${nombre}) tiene credenciales incompletas — saltando`);
      continue;
    }

    const tokenManager = new TokenManager({ apikey, username, password, baseUrl: REDGPS_BASE_URL, label: nombre });
    const client       = new RedGPSClient({ apikey, tokenManager, baseUrl: REDGPS_BASE_URL, label: nombre });

    empresas.push({ nombre, client, tokenManager });
    log('info', `Empresa registrada: "${nombre}" (apikey: ${apikey.slice(0, 8)}...)`);
  }

  // Fallback: variables legacy REDGPS_APIKEY
  if (empresas.length === 0 && process.env.REDGPS_APIKEY) {
    log('info', 'No hay EMPRESA_N_ — usando credenciales legacy REDGPS_*');
    const tokenManager = new TokenManager({
      apikey:   process.env.REDGPS_APIKEY,
      username: process.env.REDGPS_USERNAME,
      password: process.env.REDGPS_PASSWORD,
      baseUrl:  REDGPS_BASE_URL,
      label:    'Default',
    });
    const client = new RedGPSClient({
      apikey:       process.env.REDGPS_APIKEY,
      tokenManager,
      baseUrl:      REDGPS_BASE_URL,
      label:        'Default',
    });
    empresas.push({ nombre: 'Default', client, tokenManager });
  }

  if (empresas.length === 0) {
    throw new Error('No hay empresas configuradas. Definir EMPRESA_1_* o REDGPS_* en .env');
  }

  _empresas = empresas;
  log('info', `Total empresas configuradas: ${_empresas.length}`);
  return _empresas;
}

/**
 * Inicializa tokens para todas las empresas (secuencial para no saturar RedGPS).
 */
export async function initAllTokens() {
  for (const e of _empresas) {
    try {
      await e.tokenManager.init();
      log('info', `Token listo para: "${e.nombre}"`);
    } catch (err) {
      log('error', `ERROR al obtener token para "${e.nombre}": ${err.message}`);
      throw err;
    }
  }
}

/** Retorna la lista de empresas con sus clients */
export function getEmpresas() {
  return _empresas;
}

/** Retorna solo los nombres de las empresas (para el frontend) */
export function getNombresEmpresas() {
  return _empresas.map(e => e.nombre);
}

/** Busca una empresa por nombre */
export function getEmpresaPorNombre(nombre) {
  return _empresas.find(e => e.nombre === nombre) || null;
}

/** Estado de conexion de todas las empresas */
export function getStatusEmpresas() {
  return _empresas.map(e => ({
    nombre:  e.nombre,
    ...e.tokenManager.getStatus(),
  }));
}
