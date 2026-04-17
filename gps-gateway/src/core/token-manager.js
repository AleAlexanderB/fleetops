/**
 * token-manager.js
 *
 * Gestiona el ciclo de vida del TOKEN de RedGPS (6h de validez).
 * v9: Refactorizado como clase para soportar multiples empresas.
 *     Cada empresa tiene su propia instancia de TokenManager.
 *
 * - Obtiene token al arrancar
 * - Renueva automaticamente 10 min antes de expirar
 * - Si falla el refresh, reintenta con backoff hasta recuperarse
 * - Evita race conditions: multiples llamadas concurrentes esperan el mismo refresh
 */

import axios from 'axios';
import FormData from 'form-data';

const TOKEN_TTL_MS    = 6 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 10 * 60 * 1000;
const MAX_RETRIES     = 3;
const RETRY_BASE_MS   = 5000;
const RETRY_ON_FAIL_MS = 60 * 1000;

export class TokenManager {
  /**
   * @param {object} opts
   * @param {string} opts.apikey
   * @param {string} opts.username
   * @param {string} opts.password
   * @param {string} opts.baseUrl
   * @param {string} [opts.label]  - nombre para logs (ej: "Corralon el Mercado")
   */
  constructor({ apikey, username, password, baseUrl, label }) {
    this._apikey      = apikey;
    this._username    = username;
    this._password    = password;
    this._baseUrl     = baseUrl || 'http://api.service24gps.com/api/v1';
    this._label       = label   || apikey?.slice(0, 8) || '?';

    this._token        = null;
    this._renewTimer   = null;
    this._isRefreshing = false;
    this._refreshQueue = [];
  }

  _log(level, msg, data = {}) {
    console[level](`[${new Date().toISOString()}] [TokenManager:${this._label}] ${msg}`,
      Object.keys(data).length ? data : '');
  }

  async _fetchToken(attempt = 1) {
    const form = new FormData();
    form.append('apikey',   this._apikey);
    form.append('token',    '');
    form.append('username', this._username);
    form.append('password', this._password);

    try {
      const res = await axios.post(`${this._baseUrl}/gettoken`, form, {
        headers: form.getHeaders(),
        timeout: 10000,
      });
      const { status, data } = res.data;
      if (status === 200 && data) {
        this._log('info', `Token obtenido (intento ${attempt})`);
        return data;
      }
      throw new Error(`RedGPS error ${status}`);
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BASE_MS * attempt;
        this._log('warn', `Error al obtener token, reintentando en ${wait / 1000}s...`, { error: err.message });
        await new Promise(r => setTimeout(r, wait));
        return this._fetchToken(attempt + 1);
      }
      throw err;
    }
  }

  _scheduleRenewal(delayMs) {
    if (this._renewTimer) clearTimeout(this._renewTimer);
    const d = delayMs ?? (TOKEN_TTL_MS - RENEW_BEFORE_MS);
    this._renewTimer = setTimeout(async () => {
      this._log('info', 'Renovando token automaticamente...');
      try {
        await this._refresh();
      } catch (err) {
        this._log('error', `Fallo la renovacion automatica, reintentando en 1min: ${err.message}`);
        this._scheduleRenewal(RETRY_ON_FAIL_MS);
      }
    }, d);
    this._log('info', `Proxima renovacion en ${Math.round(d / 60000)} minutos`);
  }

  async _refresh() {
    if (this._isRefreshing) {
      return new Promise((resolve, reject) => {
        this._refreshQueue.push({ resolve, reject });
      });
    }
    this._isRefreshing = true;
    try {
      const newToken = await this._fetchToken();
      this._token = newToken;
      this._scheduleRenewal();
      this._refreshQueue.forEach(p => p.resolve(newToken));
      this._refreshQueue = [];
      return newToken;
    } catch (err) {
      this._refreshQueue.forEach(p => p.reject(err));
      this._refreshQueue = [];
      throw err;
    } finally {
      this._isRefreshing = false;
    }
  }

  /** Inicializa el token manager (obtiene primer token) */
  async init() {
    this._log('info', 'Iniciando token manager...');
    if (!this._apikey || !this._username || !this._password) {
      throw new Error(`[${this._label}] Faltan credenciales: apikey, username o password`);
    }
    await this._refresh();
    this._log('info', 'Token manager listo');
  }

  /** Obtiene el token actual (sincrono, lanza si no hay) */
  getToken() {
    if (!this._token) throw new Error(`[${this._label}] Token no disponible — llamar init() primero`);
    return this._token;
  }

  /** Fuerza renovacion del token (ej: tras error 30400) */
  async forceRefresh() {
    this._log('warn', 'Renovacion forzada del token (30400)');
    this._token = null;
    return this._refresh();
  }

  /** Estado para diagnostico */
  getStatus() {
    return {
      tokenPresente:        !!this._token,
      renovacionProgramada: !!this._renewTimer,
      refrescando:          this._isRefreshing,
    };
  }
}

// ── Compatibilidad legacy ────────────────────────────────────────────────────
// Para codigo que todavia importa las funciones sueltas (ej: router.js getStatus)
// Se crean cuando se llama initTokenManager() con las env vars legacy.

let _defaultInstance = null;

export async function initTokenManager() {
  _defaultInstance = new TokenManager({
    apikey:   process.env.REDGPS_APIKEY,
    username: process.env.REDGPS_USERNAME,
    password: process.env.REDGPS_PASSWORD,
    baseUrl:  process.env.REDGPS_BASE_URL || 'http://api.service24gps.com/api/v1',
    label:    'Legacy',
  });
  await _defaultInstance.init();
}

export function getToken() {
  if (!_defaultInstance) throw new Error('Token no disponible — llamar initTokenManager() primero');
  return _defaultInstance.getToken();
}

export async function forceRefresh() {
  if (!_defaultInstance) throw new Error('TokenManager no inicializado');
  return _defaultInstance.forceRefresh();
}

export function getStatus() {
  if (!_defaultInstance) return { tokenPresente: false, renovacionProgramada: false, refrescando: false };
  return _defaultInstance.getStatus();
}
