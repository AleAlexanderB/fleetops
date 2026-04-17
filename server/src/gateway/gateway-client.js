/**
 * gateway-client.js
 * Mantiene conexión SSE con el gps-gateway y provee acceso REST.
 *
 * Emite eventos (EventEmitter) que los módulos suscriben:
 *   'positions_update'  → { positions: [...] }
 *   'geocerca_entrada'  → { equipo: {...}, geocerca: {...} }
 *   'geocerca_salida'   → { equipo: {...}, geocerca: {...} }
 *   'alert'             → { alerta: {...} }
 *   'connected'         → sin datos
 *   'disconnected'      → sin datos
 */

import http    from 'http';
import axios   from 'axios';
import EventEmitter from 'events';

export const gatewayEvents = new EventEmitter();
gatewayEvents.setMaxListeners(50);

let _connected      = false;
let _reconnectTimer = null;
let _req            = null;

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [GatewayClient] ${msg}`);
}

export function getGatewayUrl() {
  return process.env.GATEWAY_URL || 'http://gps-gateway:3100';
}

function buildUrl(path) {
  const base = getGatewayUrl();
  const key  = process.env.GATEWAY_API_KEY;
  return key ? `${base}${path}?apikey=${encodeURIComponent(key)}` : `${base}${path}`;
}

function connect() {
  const rawUrl = buildUrl('/api/stream');
  log('info', `Conectando al gateway: ${getGatewayUrl()}/api/stream`);

  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { log('error', `URL gateway inválida: ${rawUrl}`); return; }

  const options = {
    hostname: parsed.hostname,
    port:     parseInt(parsed.port) || 80,
    path:     parsed.pathname + parsed.search,
    method:   'GET',
    headers:  { Accept: 'text/event-stream' },
  };

  _req = http.request(options, (res) => {
    if (res.statusCode !== 200) {
      log('error', `Gateway retornó HTTP ${res.statusCode} — reintentando en 10s`);
      res.resume();
      scheduleReconnect(10000);
      return;
    }

    _connected = true;
    log('info', 'Conexión SSE con gateway establecida ✓');
    gatewayEvents.emit('connected');

    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type) gatewayEvents.emit(event.type, event);
        } catch { /* skip malformed */ }
      }
    });

    res.on('end', () => {
      _connected = false;
      log('warn', 'Stream SSE cerrado — reconectando en 5s...');
      gatewayEvents.emit('disconnected');
      scheduleReconnect(5000);
    });

    res.on('error', (err) => {
      _connected = false;
      log('error', `Error en stream: ${err.message}`);
      scheduleReconnect(5000);
    });
  });

  _req.on('error', (err) => {
    _connected = false;
    log('warn', `No se puede conectar al gateway: ${err.message} — reintentando en 10s`);
    scheduleReconnect(10000);
  });

  _req.setTimeout(0); // sin timeout para SSE
  _req.end();
}

function scheduleReconnect(delay = 5000) {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connect();
  }, delay);
}

export function initGatewayClient() {
  connect();
}

export function isGatewayConnected() { return _connected; }

/** GET REST endpoint en el gateway, retorna data[] */
export async function gatewayGet(path) {
  const url = buildUrl(path);
  const res = await axios.get(url, { timeout: 15000 });
  if (!res.data?.ok) throw new Error(res.data?.error || `Gateway error en ${path}`);
  return res.data.data;
}
