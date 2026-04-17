/**
 * router.js
 * Endpoints REST + SSE del gateway.
 *
 * Autenticación: X-Api-Key header o ?apikey= query param.
 * Si GATEWAY_API_KEY está vacío → sin autenticación (modo interno).
 */
import { Router }           from 'express';
import { addClient }        from './sse/broadcaster.js';
import { getVehiculos, getVehiculoPorIdGps } from './modules/vehiculos.js';
import { getGeocercas, getGeocercaPorId }    from './modules/geocercas.js';
import { getPosiciones, getPosicionPorIdGps } from './modules/posiciones.js';
import { getStatusEmpresas }                  from './core/empresas.js';

const router = Router();

// ── Auth middleware ────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const apiKey = process.env.GATEWAY_API_KEY;
  if (!apiKey) return next();  // sin protección si no está configurado

  const provided = req.headers['x-api-key'] || req.query.apikey;
  if (provided === apiKey) return next();
  return res.status(401).json({ ok: false, error: 'API key requerida' });
}

router.use(authMiddleware);

// ── Health / Status ────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    service: 'gps-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    empresas: getStatusEmpresas(),
    counts: {
      vehiculos:  getVehiculos().length,
      geocercas:  getGeocercas().length,
      posiciones: getPosiciones().length,
    },
  });
});

// ── Vehículos ──────────────────────────────────────────────────────────────────
router.get('/vehicles', (req, res) => {
  const { empresa } = req.query;
  res.json({ ok: true, data: getVehiculos(empresa) });
});

router.get('/vehicles/:idgps', (req, res) => {
  const v = getVehiculoPorIdGps(req.params.idgps);
  if (!v) return res.status(404).json({ ok: false, error: 'Vehículo no encontrado' });
  res.json({ ok: true, data: v });
});

// ── Posiciones ─────────────────────────────────────────────────────────────────
router.get('/positions', (req, res) => {
  const { empresa } = req.query;
  res.json({ ok: true, data: getPosiciones(empresa), timestamp: new Date().toISOString() });
});

router.get('/positions/:idgps', (req, res) => {
  const p = getPosicionPorIdGps(req.params.idgps);
  if (!p) return res.status(404).json({ ok: false, error: 'Posición no encontrada' });
  res.json({ ok: true, data: p });
});

// ── Geocercas ──────────────────────────────────────────────────────────────────
router.get('/geocercas', (req, res) => {
  const { empresa } = req.query;
  res.json({ ok: true, data: getGeocercas(empresa) });
});

router.get('/geocercas/:id', (req, res) => {
  const g = getGeocercaPorId(req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: 'Geocerca no encontrada' });
  res.json({ ok: true, data: g });
});

// ── SSE Stream ─────────────────────────────────────────────────────────────────
router.get('/stream', (req, res) => {
  const cleanup = addClient(res);
  req.on('close', cleanup);
});

export default router;
