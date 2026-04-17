/**
 * broadcaster.js
 * Gestiona las conexiones SSE de clientes externos.
 * Todos los módulos emiten eventos aquí → se propagan a todos los clientes.
 */

const _clients = new Set();

function log(msg) {
  console.log(`[${new Date().toISOString()}] [SSE] ${msg}`);
}

/** Registra un nuevo cliente SSE. Devuelve función de cleanup. */
export function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Heartbeat cada 25s para mantener conexión viva
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  _clients.add(res);
  log(`Cliente conectado. Total: ${_clients.size}`);

  // Enviar estado actual al cliente nuevo
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString(), clients: _clients.size })}\n\n`);

  return () => {
    clearInterval(heartbeat);
    _clients.delete(res);
    log(`Cliente desconectado. Total: ${_clients.size}`);
  };
}

/** Emite un evento a todos los clientes conectados */
export function broadcast(eventType, data) {
  if (_clients.size === 0) return;
  const payload = JSON.stringify({ type: eventType, timestamp: new Date().toISOString(), ...data });
  const msg = `data: ${payload}\n\n`;
  for (const res of _clients) {
    try {
      res.write(msg);
    } catch {
      _clients.delete(res);
    }
  }
}

export function getClientCount() { return _clients.size; }
