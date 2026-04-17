/**
 * poller.js
 *
 * Orquesta todos los pollings al backend de RedGPS.
 *
 * PROTECCIÓN ANTI-SOLAPAMIENTO: si una ejecución tarda más que el intervalo,
 * la siguiente se omite en lugar de correr en paralelo y corromper el estado.
 *
 * Intervalos configurables desde .env:
 *   POLL_POSICIONES_MS   (default: 30000  — mín 30s)
 *   POLL_ALERTAS_MS      (default: 300000 — mín 5min)
 *   POLL_VEHICULOS_MS    (default: 3600000)
 *   POLL_GEOCERCAS_MS    (default: 3600000)
 */

import EventEmitter from 'events';

export const pollerEvents = new EventEmitter();
pollerEvents.setMaxListeners(20);

const intervals = [];

function log(level, msg) {
  console[level](`[${new Date().toISOString()}] [Poller] ${msg}`);
}

function ms(envVar, defaultMs, minMs = 30000) {
  const val = parseInt(process.env[envVar]);
  return isNaN(val) ? defaultMs : Math.max(val, minMs);
}

function registerPoll(name, fn, intervalMs) {
  log('info', `Registrando poll "${name}" cada ${intervalMs / 1000}s`);

  let _running = false;   // anti-solapamiento

  const run = async () => {
    if (_running) {
      log('warn', `Poll "${name}" omitido — ejecución anterior todavía en curso`);
      return;
    }
    _running = true;
    try {
      const result = await fn();
      pollerEvents.emit(name, result);
    } catch (err) {
      log('error', `Error en poll "${name}": ${err.message}`);
      pollerEvents.emit(`${name}:error`, err);
    } finally {
      _running = false;
    }
  };

  run();   // ejecutar inmediatamente al registrar
  const id = setInterval(run, intervalMs);
  intervals.push(id);
}

export function startPolling(handlers) {
  if (handlers.posiciones) {
    registerPoll('posiciones', handlers.posiciones, ms('POLL_POSICIONES_MS', 30000, 30000));
  }
  if (handlers.alertas) {
    // Alertas: mínimo 5 minutos para no saturar RedGPS y no reprocesar
    registerPoll('alertas', handlers.alertas, ms('POLL_ALERTAS_MS', 300000, 300000));
  }
  if (handlers.vehiculos) {
    registerPoll('vehiculos', handlers.vehiculos, ms('POLL_VEHICULOS_MS', 3600000, 60000));
  }
  if (handlers.geocercas) {
    registerPoll('geocercas', handlers.geocercas, ms('POLL_GEOCERCAS_MS', 3600000, 60000));
  }
  log('info', 'Todos los pollings iniciados');
}

export function stopPolling() {
  intervals.forEach(id => clearInterval(id));
  intervals.length = 0;
  log('info', 'Todos los pollings detenidos');
}
