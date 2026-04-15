/**
 * redgps-client.js
 *
 * Cliente HTTP base para todas las peticiones a RedGPS.
 * v9: Refactorizado como clase para soportar multiples empresas.
 *     Cada empresa tiene su propia instancia de RedGPSClient con su propio
 *     rate limiter y token manager.
 *
 * - Arma el form-data con apikey + token automaticamente
 * - Si recibe codigo 30400, renueva el token y reintenta UNA vez
 * - Respeta el rate limit: minimo 30s entre peticiones del mismo endpoint
 */

import axios from 'axios';
import FormData from 'form-data';

const MIN_INTERVAL_MS = 30500;   // 30.5s — spec dice minimo 30s, dejamos margen

export class RedGPSClient {
  /**
   * @param {object} opts
   * @param {string}       opts.apikey
   * @param {TokenManager} opts.tokenManager
   * @param {string}       opts.baseUrl
   * @param {string}       [opts.label]
   */
  constructor({ apikey, tokenManager, baseUrl, label }) {
    this._apikey       = apikey;
    this._tokenManager = tokenManager;
    this._baseUrl      = baseUrl || 'http://api.service24gps.com/api/v1';
    this._label        = label   || apikey?.slice(0, 8) || '?';
    this._lastCall     = {};   // rate limit per endpoint per client
  }

  _log(level, msg, data = {}) {
    console[level](`[${new Date().toISOString()}] [RedGPS:${this._label}] ${msg}`,
      Object.keys(data).length ? data : '');
  }

  async _enforceRateLimit(endpoint) {
    const last = this._lastCall[endpoint];
    if (last) {
      const elapsed = Date.now() - last;
      if (elapsed < MIN_INTERVAL_MS) {
        const wait = MIN_INTERVAL_MS - elapsed;
        this._log('warn', `Rate limit: esperando ${wait}ms antes de llamar ${endpoint}`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    this._lastCall[endpoint] = Date.now();
  }

  /**
   * Realiza una peticion POST a RedGPS.
   *
   * @param {string}  endpoint - ej: '/getdata'
   * @param {object}  params   - campos adicionales del form (sin apikey/token)
   * @param {boolean} retry    - interno: true si es segundo intento tras 30400
   * @returns {*} el campo "data" de la respuesta RedGPS
   */
  async post(endpoint, params = {}, retry = false) {
    await this._enforceRateLimit(endpoint);

    const form = new FormData();
    form.append('apikey', this._apikey);
    form.append('token',  this._tokenManager.getToken());

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        form.append(key, String(value));
      }
    }

    try {
      const res = await axios.post(`${this._baseUrl}${endpoint}`, form, {
        headers: form.getHeaders(),
        timeout: 30000,
      });

      const { status, data } = res.data;

      // Token invalido → renovar y reintentar una sola vez
      if (status === 30400 && !retry) {
        this._log('warn', `Token invalido (30400) en ${endpoint} — renovando...`);
        await this._tokenManager.forceRefresh();
        return this.post(endpoint, params, true);
      }

      // Otros errores RedGPS
      if (status !== 200) {
        const errorMap = {
          30300: 'Solicitud incorrecta (bad request)',
          30500: 'Credenciales invalidas',
          30600: 'Dispositivo incorrecto o no autorizado',
          30700: 'Error de base de datos en RedGPS',
          40100: 'No se encontraron datos',
          60500: 'Endpoint no autorizado',
          99500: 'Servicio RedGPS no disponible',
        };
        const msg = errorMap[status] || `Error RedGPS desconocido: ${status}`;
        this._log('error', `${endpoint} → ${msg}`, { status });
        throw Object.assign(new Error(msg), { redgpsCode: status });
      }

      return data;

    } catch (err) {
      if (!err.redgpsCode) {
        this._log('error', `Error de red en ${endpoint}`, { error: err.message });
      }
      throw err;
    }
  }
}

// ── Compatibilidad legacy ────────────────────────────────────────────────────
// Para codigo que todavia importa redgpsPost() directamente.
// Usa las env vars REDGPS_* y el token manager legacy.

import { getToken, forceRefresh } from './token-manager.js';

const _legacyLastCall = {};

export async function redgpsPost(endpoint, params = {}, retry = false) {
  // Rate limit
  const last = _legacyLastCall[endpoint];
  if (last) {
    const elapsed = Date.now() - last;
    if (elapsed < MIN_INTERVAL_MS) {
      const wait = MIN_INTERVAL_MS - elapsed;
      await new Promise(r => setTimeout(r, wait));
    }
  }
  _legacyLastCall[endpoint] = Date.now();

  const form = new FormData();
  form.append('apikey', process.env.REDGPS_APIKEY);
  form.append('token',  getToken());

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }

  const REDGPS_BASE_URL = process.env.REDGPS_BASE_URL || 'http://api.service24gps.com/api/v1';

  try {
    const res = await axios.post(`${REDGPS_BASE_URL}${endpoint}`, form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });

    const { status, data } = res.data;

    if (status === 30400 && !retry) {
      await forceRefresh();
      return redgpsPost(endpoint, params, true);
    }

    if (status !== 200) {
      const errorMap = {
        30300: 'Solicitud incorrecta',
        30500: 'Credenciales invalidas',
        30600: 'Dispositivo no autorizado',
        30700: 'Error de BD RedGPS',
        40100: 'Sin datos',
        60500: 'Endpoint no autorizado',
        99500: 'Servicio no disponible',
      };
      const msg = errorMap[status] || `Error RedGPS: ${status}`;
      throw Object.assign(new Error(msg), { redgpsCode: status });
    }

    return data;
  } catch (err) {
    if (!err.redgpsCode) {
      console.error(`[RedGPSClient:Legacy] Error de red en ${endpoint}: ${err.message}`);
    }
    throw err;
  }
}
