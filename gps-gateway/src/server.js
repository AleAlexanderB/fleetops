/**
 * server.js — GPS Gateway
 *
 * Único proceso que habla con RedGPS.
 * Expone REST API + SSE para todos los módulos de AB Construcciones.
 */
import dotenv from 'dotenv';
import { existsSync } from 'fs';

if (existsSync('.env')) {
  dotenv.config();
} else if (existsSync('../.env')) {
  dotenv.config({ path: '../.env' });
}

import express           from 'express';
import cors              from 'cors';
import { initEmpresas, initAllTokens, getNombresEmpresas } from './core/empresas.js';
import { startPolling }  from './core/poller.js';
import { syncVehiculos } from './modules/vehiculos.js';
import { syncGeocercas } from './modules/geocercas.js';
import { pollPosiciones } from './modules/posiciones.js';
import { pollAlertas }    from './modules/alertas.js';
import router             from './router.js';

const PORT = process.env.GATEWAY_PORT || 3100;

process.on('SIGINT',  () => { console.log('\n[gateway] SIGINT — cerrando...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[gateway] SIGTERM — cerrando...'); process.exit(0); });

async function bootstrap() {
  console.log('══════════════════════════════════════════');
  console.log('  GPS Gateway v1.0 — AB Construcciones');
  console.log(`  Puerto: ${PORT}`);
  console.log('══════════════════════════════════════════');

  // 1. Configurar empresas
  try {
    const empresas = initEmpresas();
    console.log(`[gateway] Empresas: ${empresas.map(e => e.nombre).join(', ')}`);
  } catch (err) {
    console.error('[gateway] ERROR CRÍTICO:', err.message);
    process.exit(1);
  }

  // 2. Obtener tokens
  try {
    await initAllTokens();
    console.log('[gateway] Tokens RedGPS listos');
  } catch (err) {
    console.error('[gateway] ERROR CRÍTICO: No se pudo obtener token:', err.message);
    process.exit(1);
  }

  // 3. Sincronización inicial
  console.log('[gateway] Sincronización inicial...');
  try {
    await syncGeocercas();
    await syncVehiculos();
  } catch (err) {
    console.warn('[gateway] Advertencia en sync inicial:', err.message);
  }

  // 4. Iniciar pollings
  startPolling({
    posiciones: pollPosiciones,
    alertas:    pollAlertas,
    vehiculos:  syncVehiculos,
    geocercas:  syncGeocercas,
  });

  // 5. Express
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json());
  app.use('/api', router);

  app.use((err, req, res, _next) => {
    console.error('[gateway] Error:', err);
    res.status(500).json({ ok: false, error: 'Error interno' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✓ GPS Gateway corriendo en http://0.0.0.0:${PORT}`);
    console.log(`✓ REST:   http://0.0.0.0:${PORT}/api/positions`);
    console.log(`✓ SSE:    http://0.0.0.0:${PORT}/api/stream`);
    console.log(`✓ Status: http://0.0.0.0:${PORT}/api/status`);
    console.log(`✓ Empresas: ${getNombresEmpresas().join(', ')}`);
    console.log('\nEsperando conexiones...\n');
  });
}

bootstrap();
