/**
 * server.js
 *
 * Punto de entrada del servidor FleetOPS.
 * v9: Multi-empresa — inicializa tokens y sincroniza datos de todas las cuentas RedGPS.
 *
 * Orden de arranque:
 *   1. Cargar variables de entorno
 *   2. Inicializar pool MySQL (no fatal si falla)
 *   3. Correr migraciones
 *   4. Inicializar modulos con datos de DB
 *   5. Configurar empresas (multi-cuenta RedGPS)
 *   6. Obtener tokens RedGPS para todas las empresas
 *   7. Sincronizacion inicial: vehiculos + geocercas
 *   8. Iniciar pollings
 *   9. Levantar Express
 */

import dotenv from 'dotenv';
import { existsSync } from 'fs';

// Cargar .env desde el directorio actual o el root del proyecto
if (existsSync('.env')) {
  dotenv.config();
} else if (existsSync('../.env')) {
  dotenv.config({ path: '../.env' });
}
import express           from 'express';
import cors              from 'cors';
import path              from 'path';
import { fileURLToPath } from 'url';

import { initDatabase }          from './database/database.js';
import { runMigrations }         from './database/migrate.js';
import { initEmpresas }          from './core/empresas.js';
import { startPolling }          from './core/poller.js';
import { initGatewayClient }     from './gateway/gateway-client.js';
import { syncVehiculos }         from './modules/redgps/vehiculos.js';
import { syncGeocercas }         from './modules/redgps/geocercas.js';
import { initPosicionesDesdeGateway } from './modules/redgps/posiciones.js';
import { initAlertasDesdeGateway }    from './modules/redgps/alertas.js';
import { initDivisiones }        from './modules/divisiones/divisiones.js';
import { initViajesLibres }      from './modules/viajes/libres.js';
import { initViajesProgramados } from './modules/viajes/programados.js';
import { initRutas, recalcularEstadisticasRutas } from './modules/viajes/rutas.js';
import { initTarifas }          from './modules/tarifas/tarifas.js';
import { initGeocercasTemp }    from './modules/geocercas/geocercasTemp.js';
import { initAuth }             from './modules/auth/auth.js';
import { initSync }             from './modules/sync/sync.js';
import { loadEquiposLookup }   from './modules/redgps/equipos_lookup.js';
import router                    from './router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 8077;

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[server] ${signal} recibido — cerrando servidor...`);
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  console.log('══════════════════════════════════════════');
  console.log('  FleetOPS v9 — AB Construcciones');
  console.log(`  Iniciando servidor en puerto ${PORT}...`);
  console.log('══════════════════════════════════════════');

  // 1. Base de datos MySQL (no fatal)
  await initDatabase();
  await runMigrations();

  // 2. Inicializar autenticacion (crear admin por defecto si no hay usuarios)
  await initAuth();

  // 3. Inicializar modulos con datos persistidos
  await initDivisiones();
  await initRutas();
  await initTarifas();
  await initViajesLibres();
  await initViajesProgramados();
  await initGeocercasTemp();
  loadEquiposLookup();

  // Recalcular estadísticas de rutas con trimmed mean
  await recalcularEstadisticasRutas();

  // 4. Configurar empresas (para nombres en logs — no obtiene tokens)
  let empresas;
  try {
    empresas = initEmpresas();
    console.log(`[server] Empresas: ${empresas.map(e => e.nombre).join(', ')}`);
  } catch (err) {
    console.error('[server] ERROR CRITICO:', err.message);
    process.exit(1);
  }

  // 5. Iniciar cliente del gateway GPS
  console.log('[server] Iniciando cliente GPS gateway...');
  initGatewayClient();

  // 6. Sync inicial — vehículos y geocercas (REST desde gateway)
  console.log('[server] Sincronizando datos desde gateway...');
  try {
    await syncGeocercas();
    console.log('[server] Geocercas sincronizadas desde gateway');
    await syncVehiculos();
    console.log('[server] Vehículos sincronizados desde gateway');
  } catch (err) {
    console.error('[server] Advertencia en sync inicial desde gateway:', err.message);
    console.error('[server] El sistema intentará resincronizar en el próximo ciclo.');
  }

  // 7. Iniciar procesamiento event-driven (posiciones y alertas vía gateway SSE)
  initPosicionesDesdeGateway();
  initAlertasDesdeGateway();

  // 8. Pollers periódicos — solo vehículos y geocercas (REST)
  startPolling({
    vehiculos: syncVehiculos,    // cada hora
    geocercas: syncGeocercas,    // cada hora
  });

  // 9. Sync inter-servicios (Hub, Equipos) — cada 10 min
  initSync().catch(err => console.warn('[server] initSync:', err.message));

  // 10. Express
  const app = express();

  app.use(cors({
    origin:  process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }));

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // ── API router (autenticacion via JWT + fallback X-Api-Key en router.js) ──
  app.use('/api', router);

  // Frontend estatico
  const publicDir = path.join(__dirname, '../../public');
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicDir, 'index.html'), err => {
        if (err) res.status(404).send('Frontend no encontrado — ejecuta el build primero.');
      });
    }
  });

  // Error handler
  app.use((err, req, res, _next) => {
    console.error('[server] Error no controlado:', err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✓ Servidor corriendo en http://0.0.0.0:${PORT}`);
    console.log(`✓ API disponible en http://0.0.0.0:${PORT}/api`);
    console.log(`✓ Frontend en http://0.0.0.0:${PORT}`);
    console.log(`✓ Empresas: ${empresas.map(e => e.nombre).join(', ')}`);
    console.log('\nEsperando conexiones...\n');
  });
}

bootstrap();
