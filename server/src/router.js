/**
 * router.js
 *
 * Todas las rutas REST del servidor FleetOPS.
 * v9: Multi-empresa — endpoints aceptan ?empresa= para filtrar por cuenta RedGPS.
 */

import { Router } from 'express';
import multer from 'multer';

// Parser multipart/form-data solo para webhooks que lo requieren (RedGPS .NET client)
const parseMultipart = multer().none();

// Auth
import {
  login,
  authMiddleware,
  requireAdmin,
  requireEmpresa,
  getUsuarios,
  crearUsuario,
  actualizarUsuario,
  cambiarPassword,
  eliminarUsuario,
} from './modules/auth/auth.js';

// Core
import { getNombresEmpresas, getStatusEmpresas }   from './core/empresas.js';
import { isConnected }                             from './database/database.js';
import { isGatewayConnected }                      from './gateway/gateway-client.js';

// RedGPS
import { getVehiculos, getResumenPorDivision, getVehiculoPorCodigo, getVehiculoPorPatente, setEnTaller } from './modules/redgps/vehiculos.js';
import { getGeocercas }                         from './modules/redgps/geocercas.js';
import { registrarClienteSSE, getAlertasConfig }  from './modules/redgps/posiciones.js';
import { getByImei as getEquipoPorImei }        from './modules/redgps/equipos_lookup.js';

// Geocercas temporales
import {
  getGeocercasTemp,
  crearGeocercaTemp,
  eliminarGeocercaTemp,
} from './modules/geocercas/geocercasTemp.js';

// Viajes
import {
  getViajesEnCurso,
  getViajesCompletados,
  getResumenHoy,
  getViajesDB,
  getInformeVehiculos,
  getInformeChoferes,
  getLiquidacion,
} from './modules/viajes/libres.js';

import {
  getTarifas,
  upsertTarifa,
  eliminarTarifa,
} from './modules/tarifas/tarifas.js';

import {
  crearViajeProgramado,
  actualizarViajeProgramado,
  cancelarViajeProgramado,
  getViajesProgramados,
  getResumenProgramados,
  getViajesProgramadosDB,
} from './modules/viajes/programados.js';

// Divisiones
import {
  setDivision,
  getAllDivisiones,
  getDivisionesValidas,
  agregarDivision,
  eliminarDivision,
  agregarSubdivision,
  eliminarSubdivision,
} from './modules/divisiones/divisiones.js';

// Alertas
import {
  clasificarAlerta,
  guardarAlerta,
  getAlertas,
  getResumenAlertas,
  getRankingAlertas,
  marcarLeidas,
  marcarTodasLeidas,
} from './modules/alertas/alertas.js';

import { getEmpresas } from './core/empresas.js';
import { query }       from './database/database.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// AUTH — rutas publicas (sin middleware de autenticacion)
// ══════════════════════════════════════════════════════════════════════════════

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Se requiere username y password' });
    }
    const result = await login(username, password);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

router.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK RedGPS — SIN autenticacion (RedGPS hace el POST sin token)
// Debe estar ANTES del authMiddleware
// ══════════════════════════════════════════════════════════════════════════════

router.post('/webhook/redgps', parseMultipart, async (req, res) => {
  try {
    const data = req.body;
    const log = (msg) => console.log(`[${new Date().toISOString()}] [Webhook] ${msg}`);

    // Extraer campos del POST de RedGPS (segun documentacion)
    const descripcion = data.description || data.descripcion || data.Descripcion || '';
    const equipoRaw   = data.device  || data.equipo  || data.Equipo  || data.vehicle || '';
    const fecha       = data.date    || data.fecha   || data.Fecha   || '';
    const hora        = data.time    || data.hora    || data.Hora    || '';
    const lat         = parseFloat(data.latitude  || data.Latitud  || data.lat || 0);
    const lng         = parseFloat(data.longitude || data.Longitud || data.lng || 0);
    const velocidad   = parseFloat(data.speed     || data.velocidad || 0);
    const conductor   = data.Conductor || data.conductor || data.driver || null;
    const patenteRaw  = data.patent  || data.patente || data.UnitPlate || null;
    const idAlerta    = data.idalert || data.idAlert || null;

    // RedGPS manda el IMEI en data.device; resolver a codigo+patente via catalogo RedGPS
    // Regla: el CODIGO del activo es el identificador primario, la patente secundaria.
    const imeiOrCodigo = String(equipoRaw).trim().split(/\s+/)[0];
    const equipoCatalogo = /^\d{10,}$/.test(imeiOrCodigo) ? getEquipoPorImei(imeiOrCodigo) : null;

    const codigoEquipo = equipoCatalogo?.codigo || imeiOrCodigo.toUpperCase();
    const patente      = equipoCatalogo?.patente || patenteRaw || null;
    const clienteRedGPS = equipoCatalogo?.cliente || null;

    log(`Alerta recibida: "${descripcion}" codigo=${codigoEquipo}${patente ? ' patente='+patente : ''}${equipoCatalogo ? '' : ' (sin match catalogo, imei='+imeiOrCodigo+')'} ${fecha} ${hora}`);

    // Resolver vehiculo en BD FleetOPS (usa codigo o patente segun como esté cargado hoy)
    const vehiculo = getVehiculoPorCodigo(codigoEquipo)
                  || (patente ? getVehiculoPorPatente(patente) : null)
                  || null;

    const timestamp = (fecha && hora) ? `${fecha}T${hora}` : new Date().toISOString();

    // Clasificar tipo de alerta
    const tipoAlerta = clasificarAlerta(descripcion);

    // Extraer nombre de geocerca si es alerta de geocerca
    let nombreGeocerca = null;
    if (tipoAlerta === 'geocerca_ingreso' || tipoAlerta === 'geocerca_salida') {
      nombreGeocerca = descripcion
        .replace(/ingresa\s*(a\s*)?/gi, '')
        .replace(/sale\s*(de\s*)?/gi, '')
        .replace(/entrada\s*(a\s*)?/gi, '')
        .replace(/salida\s*(de\s*)?/gi, '')
        .replace(/salio\s*(de\s*)?/gi, '')
        .replace(/entra\s*(a\s*)?/gi, '')
        .trim();
    }

    // PERSISTIR solo alertas operativas (no geocercas — esas van por viajes)
    const esGeocerca = tipoAlerta === 'geocerca_ingreso' || tipoAlerta === 'geocerca_salida';
    if (!esGeocerca) {
      try {
        await guardarAlerta({
          tipo:            tipoAlerta,
          codigoEquipo:    vehiculo?.codigo || codigoEquipo || null,
          patente:         vehiculo?.patente || patente,
          etiqueta:        vehiculo?.etiqueta || codigoEquipo || patente || equipo,
          empresa:         vehiculo?.empresa || null,
          division:        vehiculo?.division || null,
          descripcion:     descripcion,
          geocerca:        null,
          latitud:         lat || null,
          longitud:        lng || null,
          velocidad:       velocidad || null,
          conductor:       vehiculo?.conductor || conductor,
          timestampAlerta: timestamp,
        });
      } catch (dbErr) {
        log(`Error al persistir alerta (continua igualmente): ${dbErr.message}`);
      }
    }

    // Para geocercas: procesar como viaje libre tambien
    if (tipoAlerta === 'geocerca_ingreso' || tipoAlerta === 'geocerca_salida') {
      const tipo = tipoAlerta === 'geocerca_ingreso' ? 'ingresa' : 'sale';

      if (!nombreGeocerca) {
        log(`No se pudo extraer geocerca de: "${descripcion}"`);
        res.json({ ok: true, saved: true, processed: false, reason: 'no_geocerca_name' });
        return;
      }

      const geocercas = getGeocercas();
      const norm = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
      const geoNorm = norm(nombreGeocerca);
      const geocerca = geocercas.find(g => norm(g.nombre) === geoNorm)
                    || geocercas.find(g => norm(g.nombre).includes(geoNorm) || geoNorm.includes(norm(g.nombre)));

      if (!geocerca) {
        log(`Geocerca no encontrada: "${nombreGeocerca}"`);
        res.json({ ok: true, saved: true, processed: false, reason: 'geocerca_not_found', geocerca: nombreGeocerca });
        return;
      }

      const veh = vehiculo || {
        codigo:    codigoEquipo,
        patente:   patente,
        etiqueta:  codigoEquipo || patente || equipo,
        empresa:   null,
        chofer:    null,
        division:  null,
        subgrupo:  null,
        conductor: conductor,
      };

      const { procesarAlertaRedGPS } = await import('./modules/viajes/libres.js');
      await procesarAlertaRedGPS({
        vehiculo: veh,
        tipo,
        geocerca: { idCerca: geocerca.idCerca, nombre: geocerca.nombre },
        timestamp,
      });

      log(`✓ Procesada: ${codigoEquipo} ${tipo} "${geocerca.nombre}" @ ${timestamp}`);
      res.json({ ok: true, saved: true, processed: true, equipo: codigoEquipo, tipo, geocerca: geocerca.nombre });
      return;
    }

    log(`✓ Alerta guardada: ${tipoAlerta} equipo=${codigoEquipo}`);
    res.json({ ok: true, saved: true, processed: false, tipo: tipoAlerta, equipo: codigoEquipo });

  } catch (err) {
    console.error(`[Webhook] Error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/webhook/test', (req, res) => {
  res.json({
    ok: true,
    message: 'Webhook endpoint activo',
    url: '/api/webhook/redgps',
    method: 'POST',
    timestamp: new Date().toISOString(),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SSO + Webhook con Hub AB — SIN authMiddleware (2026-04-23)
// ══════════════════════════════════════════════════════════════════════════════

// /sso?token=xxx — guarda el JWT del Hub en localStorage y redirige a /
router.get('/sso', (req, res) => {
  const token = req.query.token || '';
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Entrando a FleetOPS…</title></head><body>
    <p style="font-family:sans-serif;color:#555;text-align:center;margin-top:40px">Entrando a FleetOPS…</p>
    <script>
      try {
        const t = ${JSON.stringify(token)};
        if (t) localStorage.setItem('fleetops_token', t);
      } catch (e) {}
      window.location.replace('/');
    </script>
  </body></html>`);
});

// Webhook de invalidacion de cache — consumido por el Hub AB
router.post('/cache-invalidate', (req, res) => {
  const key = req.headers['x-webhook-key'];
  if (!process.env.WEBHOOK_API_KEY || key !== process.env.WEBHOOK_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Webhook key invalida' });
  }
  const { entidad, entidadId, accion, timestamp } = req.body || {};
  console.log(`[${new Date().toISOString()}] [Webhook] ✓ invalidate ${entidad}${entidadId != null ? '#' + entidadId : ''} ${accion || ''}`);
  // Fase C+1: invalidar caches especificos segun entidad
  res.json({ ok: true, received: { entidad, entidadId, accion, timestamp } });
});

// ══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE — autenticacion global para todas las rutas siguientes
// ══════════════════════════════════════════════════════════════════════════════

router.use(authMiddleware);

// ══════════════════════════════════════════════════════════════════════════════
// USUARIOS — gestion de usuarios (solo admin)
// ══════════════════════════════════════════════════════════════════════════════

router.get('/usuarios', requireAdmin, async (req, res) => {
  try {
    const usuarios = await getUsuarios();
    res.json({ ok: true, data: usuarios });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/usuarios', requireAdmin, async (req, res) => {
  try {
    const usuario = await crearUsuario(req.body);
    res.status(201).json({ ok: true, data: usuario });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/usuarios/:id', requireAdmin, async (req, res) => {
  try {
    const usuario = await actualizarUsuario(Number(req.params.id), req.body);
    res.json({ ok: true, data: usuario });
  } catch (err) {
    res.status(err.message.includes('no encontrado') ? 404 : 400)
       .json({ ok: false, error: err.message });
  }
});

router.put('/usuarios/:id/password', requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    await cambiarPassword(Number(req.params.id), password);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/usuarios/:id', requireAdmin, async (req, res) => {
  try {
    await eliminarUsuario(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.message.includes('no encontrado') ? 404 : 400)
       .json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// RUTAS DE DATOS — con filtro de empresa para usuarios tipo "empresa"
// ══════════════════════════════════════════════════════════════════════════════

// ── Empresas ─────────────────────────────────────────────────────────────────

router.get('/empresas', (req, res) => {
  res.json({
    ok: true,
    data: getNombresEmpresas(),
    status: getStatusEmpresas(),
  });
});

// ── Diagnostico ──────────────────────────────────────────────────────────────

router.get('/diagnostico', (req, res) => {
  const { empresa } = req.query;
  const vehiculos  = getVehiculos(empresa || undefined);
  const geocercas  = getGeocercas(empresa || undefined);

  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    empresas: getNombresEmpresas(),
    vehiculos: {
      total: vehiculos.length,
      muestra: vehiculos.slice(0, 3).map(v => ({
        codigo:      v.codigo,
        etiqueta:    v.etiqueta,
        patente:     v.patente,
        empresa:     v.empresa,
        idgps:       v.idgps,
        latitud:     v.latitud,
        longitud:    v.longitud,
        geocerca:    v.geocercaActual,
        estado:      v.estado,
      })),
    },
    geocercas: {
      total: geocercas.length,
      visibles: geocercas.filter(g => Number(g.visible) !== 0).length,
      tiposDistribucion: geocercas.reduce((acc, g) => {
        const tipo = `tipo_${g.tipoCerca}`;
        acc[tipo] = (acc[tipo] || 0) + 1;
        return acc;
      }, {}),
      muestra: geocercas.filter(g => Number(g.visible) !== 0).slice(0, 3).map(g => ({
        idCerca:   g.idCerca,
        nombre:    g.nombre,
        tipo:      g.tipoCerca,
        empresa:   g.empresa,
        puntos:    g.puntos?.length ?? 0,
        radio:     g.radio,
        equiposDentro: g.equiposDentro,
      })),
    },
  });
});

router.get('/status', (req, res) => {
  // v9: tokens los maneja el gateway — tokenPresente = gateway SSE conectado
  const gatewayConectado = isGatewayConnected();
  res.json({
    ok:        true,
    redgps:    { tokenPresente: gatewayConectado, gateway: gatewayConectado, renovacionProgramada: true, refrescando: false },
    empresas:  getNombresEmpresas().map(n => ({ nombre: n, tokenPresente: gatewayConectado })),
    mysql:     { conectado: isConnected() },
    timestamp: new Date().toISOString(),
  });
});

// Estado de sincronización con Hub/Equipos. Lo usa la pantalla de Configuración
// para mostrar "Sincronizado hace X min" o "⚠ Hub no responde".
router.get('/sync/status', async (req, res) => {
  try {
    const { getSyncStatus } = await import('./modules/sync/sync.js');
    const status = await getSyncStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Forzar un sync manual (no esperar el próximo tick de 10 min).
// Lo usa el botón "Sincronizar ahora" de la UI y para debugging.
router.post('/sync/run', requireAdmin, async (req, res) => {
  try {
    const { runAllNow } = await import('./modules/sync/sync.js');
    const before = Date.now();
    await runAllNow();
    res.json({ ok: true, durationMs: Date.now() - before });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lista de asignaciones equipo→unidad sincronizadas desde Equipos, cruzadas
// con la flota GPS (RedGPS via gateway). Sirve para verificar matching y
// detectar equipos del catálogo que no aparecen en GPS o viceversa.
router.get('/equipos-asignacion', requireEmpresa, async (req, res) => {
  try {
    const pool = (await import('./database/database.js')).db();
    if (!pool) return res.json({ ok: true, data: [] });
    const [rows] = await pool.execute(
      `SELECT codigo_equipo, codigo_interno, patente,
              unidad_negocio_id, unidad_negocio_nombre,
              subdivision_id, subdivision_nombre,
              estado, empresa_codigo, sincronizado_en
         FROM fleetops_equipo_asignacion
         ORDER BY codigo_equipo ASC`
    );
    const vehiculosGps = new Map(
      getVehiculos().map(v => [(v.codigo || '').toUpperCase(), v])
    );
    const data = rows.map(r => {
      const v = vehiculosGps.get((r.codigo_equipo || '').toUpperCase());
      return {
        codigoEquipo:        r.codigo_equipo,
        codigoInterno:       r.codigo_interno,
        patente:             r.patente,
        unidadNegocioId:     r.unidad_negocio_id,
        unidadNegocioNombre: r.unidad_negocio_nombre,
        subdivisionId:       r.subdivision_id,
        subdivisionNombre:   r.subdivision_nombre,
        estadoEquipo:        r.estado,
        empresaCodigo:       r.empresa_codigo,
        sincronizadoEn:      r.sincronizado_en?.toISOString?.() ?? r.sincronizado_en,
        gpsMatch:            !!v,
        gpsPatente:          v?.patente ?? null,
      };
    });
    res.json({ ok: true, data, total: data.length, gpsMatched: data.filter(d => d.gpsMatch).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Re-match retroactivo de programados ─────────────────────────────────────

router.post('/viajes/programados/rematch', requireAdmin, async (req, res) => {
  try {
    const { fecha } = req.body;
    const fechaTarget = fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

    // 1. Obtener todos los programados del dia que siguen pendientes o sin vinculo completo
    const [progs] = await query(
      `SELECT * FROM fleetops_viajes_programados
       WHERE fecha_inicio = ?
         AND cancelado = 0
         AND (id_viaje_libre IS NULL OR llegada_real IS NULL)
       ORDER BY hora_inicio ASC`,
      [fechaTarget]
    );

    if (!progs.length) return res.json({ ok: true, mensaje: 'No hay programados pendientes para re-matchear', actualizados: 0 });

    // 2. Obtener TODOS los viajes libres completados del dia desde DB
    const [libres] = await query(
      `SELECT id_viaje_libre, codigo_equipo, patente,
              id_geocerca_origen,  nombre_geocerca_origen,
              id_geocerca_destino, nombre_geocerca_destino,
              timestamp_inicio, timestamp_fin, duracion_min, km_recorridos
       FROM fleetops_viajes_libres
       WHERE DATE(timestamp_inicio) = ?
         AND estado = 'completado'
         AND id_geocerca_destino IS NOT NULL
         AND id_geocerca_destino != 0
       ORDER BY timestamp_inicio ASC`,
      [fechaTarget]
    );

    console.log(`[Rematch] Programados pendientes: ${progs.length} | Libres completados disponibles: ${libres.length}`);

    const TOLERANCIA_MS = 3 * 60 * 60 * 1000; // ±3 horas
    const usados = new Set(); // libres ya asignados
    const actualizados = [];
    const noEncontrados = [];

    for (const vp of progs) {
      const vpKey = (vp.codigo_equipo || vp.patente || '').toUpperCase();
      // fecha_inicio puede volver como Date de mysql2 — convertir a string 'YYYY-MM-DD'
      const fechaInicioStr = vp.fecha_inicio instanceof Date
        ? vp.fecha_inicio.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
        : String(vp.fecha_inicio).split('T')[0];
      const programadoMs = new Date(`${fechaInicioStr}T${vp.hora_inicio}-03:00`).getTime();

      const match = libres.find(vl => {
        if (usados.has(vl.id_viaje_libre)) return false;
        const vlKey = (vl.codigo_equipo || vl.patente || '').toUpperCase();
        if (vlKey !== vpKey) return false;
        if (!vp.id_geocerca_origen || !vp.id_geocerca_destino) return false;
        if (vl.id_geocerca_origen  !== vp.id_geocerca_origen)  return false;
        if (vl.id_geocerca_destino !== vp.id_geocerca_destino) return false;
        const viajeMs = new Date(vl.timestamp_inicio).getTime();
        return Math.abs(viajeMs - programadoMs) <= TOLERANCIA_MS;
      });

      if (match) {
        usados.add(match.id_viaje_libre);

        // Calcular demora de salida en minutos
        const salidaReal   = new Date(match.timestamp_inicio);
        const salidaProgMs = programadoMs;
        const demoraMin    = Math.round((salidaReal.getTime() - salidaProgMs) / 60000);

        await query(
          `UPDATE fleetops_viajes_programados
           SET id_viaje_libre     = ?,
               salida_real        = ?,
               llegada_real       = ?,
               duracion_real_min  = ?,
               demora_salida_min  = ?,
               km_reales          = ?,
               actualizado_en     = CURRENT_TIMESTAMP
           WHERE id_viaje_programado = ?`,
          [
            match.id_viaje_libre,
            match.timestamp_inicio,
            match.timestamp_fin,
            match.duracion_min || null,
            demoraMin,
            match.km_recorridos || null,
            vp.id_viaje_programado,
          ]
        );

        actualizados.push({
          id: vp.id_viaje_programado,
          equipo: vpKey,
          ruta: `${vp.nombre_geocerca_origen} → ${vp.nombre_geocerca_destino}`,
          hora: vp.hora_inicio,
          libIdVinculado: match.id_viaje_libre,
          salidaReal: match.timestamp_inicio,
          llegadaReal: match.timestamp_fin,
          demora: demoraMin,
        });
        console.log(`[Rematch] ✓ Vinculado prog #${vp.id_viaje_programado} (${vpKey} ${vp.hora_inicio}) → libre #${match.id_viaje_libre}`);
      } else {
        noEncontrados.push({
          id: vp.id_viaje_programado,
          equipo: vpKey,
          ruta: `${vp.nombre_geocerca_origen} → ${vp.nombre_geocerca_destino}`,
          hora: vp.hora_inicio,
          motivo: !vp.id_geocerca_origen || !vp.id_geocerca_destino ? 'Geocerca sin ID' : 'Sin match en libres',
        });
      }
    }

    // Refrescar programados en memoria recargando desde DB
    const { initViajesProgramados } = await import('./modules/viajes/programados.js');
    await initViajesProgramados();

    res.json({ ok: true, fecha: fechaTarget, actualizados: actualizados.length, noEncontrados: noEncontrados.length, detalle: actualizados, sinMatch: noEncontrados });
  } catch (e) {
    console.error('[Rematch] Error:', e);
    res.json({ ok: false, error: e.message });
  }
});

router.get('/debug/libres-db-hoy', async (req, res) => {
  try {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const equipos = ['B012','B030','B036','B037','B038','B042','B047'];
    const placeholders = equipos.map(() => '?').join(',');
    const [rows] = await query(
      `SELECT id_viaje_libre, codigo_equipo, patente,
              id_geocerca_origen, nombre_geocerca_origen,
              id_geocerca_destino, nombre_geocerca_destino,
              timestamp_inicio, timestamp_fin, duracion_min, estado
       FROM fleetops_viajes_libres
       WHERE DATE(timestamp_inicio) = ?
         AND (codigo_equipo IN (${placeholders}) OR patente IN (${placeholders}))
       ORDER BY codigo_equipo, timestamp_inicio`,
      [hoy, ...equipos, ...equipos]
    );
    res.json({ ok: true, total: rows.length, data: rows });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── DEBUG — solo para diagnostico, requiere admin ────────────────────────────

router.get('/debug/sync-log', async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT operacion, resultado, detalles, iniciado_en, duracion_ms
       FROM fleetops_sync_log ORDER BY iniciado_en DESC LIMIT 30`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.get('/debug/getalerts-sample', async (req, res) => {
  try {
    const empresas = getEmpresas();
    if (!empresas.length) return res.json({ ok: false, error: 'Sin empresas configuradas' });
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const client = empresas[0].client;

    // Probar distintas combinaciones de parametros
    const intentos = [
      { dateIni: `${hoy} 00:00:00`, dateEnd: `${hoy} 23:59:59` },
      { startDate: `${hoy} 00:00:00`, endDate: `${hoy} 23:59:59` },
      { FechaInicio: `${hoy} 00:00:00`, FechaFin: `${hoy} 23:59:59` },
      { dateFrom: `${hoy} 00:00:00`, dateTo: `${hoy} 23:59:59` },
      { date_ini: `${hoy} 00:00:00`, date_end: `${hoy} 23:59:59` },
      { date: hoy },
    ];

    const resultados = [];
    for (const params of intentos) {
      try {
        const data = await client.post('/getAlerts', params);
        const muestra = Array.isArray(data) ? data.slice(0, 3) : data;
        const claves  = Array.isArray(data) && data.length > 0 ? Object.keys(data[0]) : [];
        resultados.push({ params, ok: true, total: Array.isArray(data) ? data.length : '?', claves, muestra });
        break; // exito — no seguir probando
      } catch (e) {
        resultados.push({ params, ok: false, error: e.message });
      }
    }
    res.json({ ok: true, empresa: empresas[0].nombre, resultados });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── DEBUG: Ver datos raw para diagnostico de rematch ─────────────────────────
router.get('/debug/rematch-data', requireAdmin, async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const [progs] = await query(
      `SELECT id_viaje_programado, codigo_equipo, patente, fecha_inicio, hora_inicio,
              id_geocerca_origen, id_geocerca_destino, nombre_geocerca_origen, nombre_geocerca_destino,
              id_viaje_libre, llegada_real, cancelado
       FROM fleetops_viajes_programados WHERE fecha_inicio = ? AND cancelado = 0
       ORDER BY hora_inicio`, [fecha]);
    const [libres] = await query(
      `SELECT id_viaje_libre, codigo_equipo, patente, id_geocerca_origen, id_geocerca_destino,
              nombre_geocerca_origen, nombre_geocerca_destino,
              timestamp_inicio, timestamp_fin, estado
       FROM fleetops_viajes_libres WHERE DATE(timestamp_inicio) = ?
       ORDER BY timestamp_inicio`, [fecha]);
    // Mostrar tipos de datos
    const tiposProg  = progs.length  > 0 ? Object.fromEntries(Object.entries(progs[0]).map(([k,v])  => [k, typeof v  + (v instanceof Date ? '(Date)' : '')])) : {};
    const tiposLibre = libres.length > 0 ? Object.fromEntries(Object.entries(libres[0]).map(([k,v]) => [k, typeof v + (v instanceof Date ? '(Date)' : '')])) : {};
    res.json({ ok: true, fecha, progCount: progs.length, libreCount: libres.length, tiposProg, tiposLibre, progs, libres });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── DEBUG: Insertar viajes libres desde datos del PDF (reparacion manual) ────
router.post('/debug/insert-libres-pdf', requireAdmin, async (req, res) => {
  try {
    const viajes = [
      {
        codigo_equipo: 'B012',
        patente: 'AC043SL',
        id_geocerca_origen: 94972,
        nombre_geocerca_origen: 'ARENALES',
        id_geocerca_destino: 1052940,
        nombre_geocerca_destino: 'MALVINAS',
        timestamp_inicio: '2026-04-15 08:11:04',
        timestamp_fin: '2026-04-15 08:20:43',
        duracion_min: 9,
        estado: 'completado',
      },
      {
        codigo_equipo: 'B030',
        patente: 'AF529JL',
        id_geocerca_origen: 94972,
        nombre_geocerca_origen: 'ARENALES',
        id_geocerca_destino: 493586,
        nombre_geocerca_destino: 'AGI',
        timestamp_inicio: '2026-04-15 05:53:39',
        timestamp_fin: '2026-04-15 08:14:47',
        duracion_min: 141,
        estado: 'completado',
      },
    ];

    const resultados = [];
    for (const v of viajes) {
      // Verificar si ya existe un viaje con MISMO equipo, origen Y destino en ese dia
      const [existentes] = await query(
        `SELECT id_viaje_libre FROM fleetops_viajes_libres
         WHERE codigo_equipo = ? AND id_geocerca_origen = ? AND id_geocerca_destino = ?
           AND DATE(timestamp_inicio) = DATE(?)
         LIMIT 1`,
        [v.codigo_equipo, v.id_geocerca_origen, v.id_geocerca_destino, v.timestamp_inicio]
      );
      if (existentes.length > 0) {
        resultados.push({ equipo: v.codigo_equipo, accion: 'OMITIDO', motivo: 'ya existe', id: existentes[0].id_viaje_libre });
        continue;
      }
      const [ins] = await query(
        `INSERT INTO fleetops_viajes_libres
           (codigo_equipo, patente, id_geocerca_origen, nombre_geocerca_origen,
            id_geocerca_destino, nombre_geocerca_destino,
            timestamp_inicio, timestamp_fin, duracion_min, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.codigo_equipo, v.patente, v.id_geocerca_origen, v.nombre_geocerca_origen,
         v.id_geocerca_destino, v.nombre_geocerca_destino,
         v.timestamp_inicio, v.timestamp_fin, v.duracion_min, v.estado]
      );
      resultados.push({ equipo: v.codigo_equipo, accion: 'INSERTADO', id: ins.insertId,
                        origen: v.nombre_geocerca_origen, destino: v.nombre_geocerca_destino });
    }
    res.json({ ok: true, resultados });
  } catch (e) {
    console.error('[insert-libres-pdf] Error:', e);
    res.json({ ok: false, error: e.message });
  }
});

// ── DEBUG: Corregir IDs de geocercas en programados (SAN IGNACIO PALLET → PALLET MOSCA) ─
router.post('/debug/fix-geocercas-programados', requireAdmin, async (req, res) => {
  try {
    const PALLET_MOSCA_ID   = 1066196;
    const PALLET_MOSCA_NOMBRE = 'PALLET MOSCA';

    // 1. Filas donde origen = SAN IGNACIO PALLET (id=0)
    const [r1] = await query(
      `UPDATE fleetops_viajes_programados
       SET id_geocerca_origen = ?, nombre_geocerca_origen = ?
       WHERE nombre_geocerca_origen IN ('SAN IGNACIO PALLET','SAN IGNACIO PALLET ')
         AND (id_geocerca_origen IS NULL OR id_geocerca_origen = 0)`,
      [PALLET_MOSCA_ID, PALLET_MOSCA_NOMBRE]
    );

    // 2. Filas donde destino = SAN IGNACIO PALLET (id=0)
    const [r2] = await query(
      `UPDATE fleetops_viajes_programados
       SET id_geocerca_destino = ?, nombre_geocerca_destino = ?
       WHERE nombre_geocerca_destino IN ('SAN IGNACIO PALLET','SAN IGNACIO PALLET ')
         AND (id_geocerca_destino IS NULL OR id_geocerca_destino = 0)`,
      [PALLET_MOSCA_ID, PALLET_MOSCA_NOMBRE]
    );

    res.json({
      ok: true,
      origenActualizados: r1.affectedRows,
      destinoActualizados: r2.affectedRows,
      mensaje: `SAN IGNACIO PALLET → PALLET MOSCA (id=${PALLET_MOSCA_ID})`,
    });
  } catch (e) {
    console.error('[fix-geocercas-programados] Error:', e);
    res.json({ ok: false, error: e.message });
  }
});

// Compatibilidad con Fase 2
router.get('/redgps/status', (req, res) => {
  const gatewayConectado = isGatewayConnected();
  res.json({
    ok: true,
    redgps: { tokenPresente: gatewayConectado, gateway: gatewayConectado, renovacionProgramada: true, refrescando: false },
    empresas: getNombresEmpresas().map(n => ({ nombre: n, tokenPresente: gatewayConectado })),
    timestamp: new Date().toISOString(),
  });
});

router.get('/db/status', (req, res) => {
  res.json({ ok: true, mysqlConectado: isConnected() });
});

// ── Vehiculos ────────────────────────────────────────────────────────────────

router.get('/vehiculos', requireEmpresa, (req, res) => {
  const { division, subgrupo, estado, empresa } = req.query;
  let lista = getVehiculos(empresa || undefined);
  if (division) lista = lista.filter(v => v.division === division);
  if (subgrupo) lista = lista.filter(v => v.subgrupo === subgrupo);
  if (estado)   lista = lista.filter(v => v.estado   === estado);
  res.json({ ok: true, total: lista.length, data: lista });
});

router.get('/vehiculos/resumen', requireEmpresa, (req, res) => {
  const { empresa } = req.query;
  res.json({ ok: true, data: getResumenPorDivision(empresa || undefined) });
});

router.put('/vehiculos/:codigo/taller', (req, res) => {
  try {
    const codigo = decodeURIComponent(req.params.codigo);
    const { enTaller } = req.body;
    if (typeof enTaller !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Se espera { enTaller: boolean }' });
    }
    setEnTaller(codigo, enTaller);
    res.json({ ok: true, codigo, enTaller });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Geocercas ────────────────────────────────────────────────────────────────

router.get('/geocercas', requireEmpresa, (req, res) => {
  const { empresa } = req.query;
  res.json({ ok: true, data: getGeocercas(empresa || undefined) });
});

// ── Geocercas temporales ────────────────────────────────────────────────────

router.get('/geocercas/temp', (req, res) => {
  res.json({ ok: true, data: getGeocercasTemp() });
});

router.post('/geocercas/temp', async (req, res) => {
  try {
    const { nombre, latitud, longitud, radio, viajeProgramadoId, tipo } = req.body;
    const geocerca = await crearGeocercaTemp({ nombre, latitud, longitud, radio, viajeProgramadoId, tipo });
    res.status(201).json({ ok: true, data: geocerca });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/geocercas/temp/:id', requireAdmin, async (req, res) => {
  try {
    const geocerca = await eliminarGeocercaTemp(Number(req.params.id));
    res.json({ ok: true, data: geocerca });
  } catch (err) {
    res.status(err.message.includes('no encontrada') ? 404 : 400)
       .json({ ok: false, error: err.message });
  }
});

// ── SSE — posiciones en tiempo real ─────────────────────────────────────────

router.get('/posiciones/stream', requireEmpresa, (req, res) => {
  registrarClienteSSE(req, res);
});

// ── Viajes libres ────────────────────────────────────────────────────────────

router.get('/viajes/libres', requireEmpresa, (req, res) => {
  const { division, subgrupo, patente, fecha, empresa } = req.query;
  const completados = getViajesCompletados({ division, subgrupo, patente, fecha });

  let enCursoList = getViajesEnCurso();
  if (division) enCursoList = enCursoList.filter(v => v.division === division);
  if (subgrupo) enCursoList = enCursoList.filter(v => v.subgrupo === subgrupo);
  if (patente)  enCursoList = enCursoList.filter(v => v.patente  === patente);

  // Filtro por empresa: resolver codigo del equipo → empresa
  let compFilt = completados;
  let ecFilt   = enCursoList;
  if (empresa) {
    const vehiculos = getVehiculos(empresa);
    const codigosEmpresa = new Set(vehiculos.map(v => v.codigo));
    compFilt = completados.filter(v => codigosEmpresa.has(v.codigo || v.codigoEquipo));
    ecFilt   = enCursoList.filter(v => codigosEmpresa.has(v.codigo || v.codigoEquipo));
  }

  res.json({
    ok:         true,
    resumen: {
      completados: compFilt.length,
      enCurso:     ecFilt.length,
      total:       compFilt.length + ecFilt.length,
      kmTotal:     compFilt.reduce((s, v) => s + (v.kmRecorridos || 0), 0),
    },
    enCurso:     ecFilt,
    completados: compFilt,
  });
});

router.get('/viajes/libres/resumen', requireEmpresa, (req, res) => {
  res.json({ ok: true, data: getResumenHoy() });
});

// Historial paginado en MySQL
router.get('/viajes/libres/historico', requireEmpresa, async (req, res) => {
  try {
    const { patente, codigoEquipo, division, subgrupo, desde, hasta, page, pageSize } = req.query;
    const result = await getViajesDB({
      patente, codigoEquipo, division, subgrupo, desde, hasta,
      page:     parseInt(page)     || 1,
      pageSize: parseInt(pageSize) || 50,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Viajes programados ───────────────────────────────────────────────────────

router.get('/viajes/programados', requireEmpresa, (req, res) => {
  const { fecha, patente, codigoEquipo, division, estado, empresa, incluirEnCurso } = req.query;
  const filters = {
    fecha, patente, codigoEquipo, division, estado, empresa,
    incluirEnCurso: incluirEnCurso === 'true' || incluirEnCurso === '1',
  };
  res.json({
    ok:      true,
    resumen: getResumenProgramados(filters),
    data:    getViajesProgramados(filters),
  });
});

router.get('/viajes/programados/historico', requireEmpresa, async (req, res) => {
  try {
    const { patente, codigoEquipo, division, desde, hasta, estado, page, pageSize, empresa } = req.query;
    const result = await getViajesProgramadosDB({
      patente, codigoEquipo, division, desde, hasta, estado, empresa,
      page:     parseInt(page)     || 1,
      pageSize: parseInt(pageSize) || 50,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/viajes/programados', async (req, res) => {
  try {
    const vp = await crearViajeProgramado(req.body);
    res.status(201).json({ ok: true, data: vp });
  } catch (err) {
    if (err.code === 'EQUIPO_OCUPADO') {
      return res.status(409).json({
        ok: false, error: err.message, code: err.code, detalle: err.detalle,
      });
    }
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.put('/viajes/programados/:id', async (req, res) => {
  try {
    const vp = await actualizarViajeProgramado(Number(req.params.id), req.body);
    res.json({ ok: true, data: vp });
  } catch (err) {
    res.status(err.message.includes('no encontrado') ? 404 : 400)
       .json({ ok: false, error: err.message });
  }
});

router.delete('/viajes/programados/:id', requireAdmin, async (req, res) => {
  try {
    const motivo = req.body?.motivo || null;
    const vp = await cancelarViajeProgramado(Number(req.params.id), motivo);
    res.json({ ok: true, data: vp });
  } catch (err) {
    res.status(err.message.includes('no encontrado') ? 404 : 400)
       .json({ ok: false, error: err.message });
  }
});

// ── Informes de rendimiento ──────────────────────────────────────────────────

router.get('/informes/vehiculos', requireEmpresa, async (req, res) => {
  try {
    const { desde, hasta, division, empresa } = req.query;
    const result = await getInformeVehiculos({ desde, hasta, division, empresa });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/informes/choferes', requireEmpresa, async (req, res) => {
  try {
    const { desde, hasta, division, empresa } = req.query;
    const result = await getInformeChoferes({ desde, hasta, division, empresa });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/informes/liquidacion', requireEmpresa, async (req, res) => {
  try {
    const { desde, hasta, division, chofer, empresa } = req.query;
    const result = await getLiquidacion({ desde, hasta, division, chofer, empresa });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Tarifas de rutas ────────────────────────────────────────────────────────

router.get('/tarifas', (req, res) => {
  res.json({ ok: true, data: getTarifas() });
});

router.post('/tarifas', requireAdmin, async (req, res) => {
  try {
    const tarifa = await upsertTarifa(req.body);
    res.status(201).json({ ok: true, data: tarifa });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/tarifas/:id', requireAdmin, async (req, res) => {
  try {
    await eliminarTarifa(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Divisiones ───────────────────────────────────────────────────────────────

router.get('/divisiones', (req, res) => {
  res.json({ ok: true, data: getAllDivisiones() });
});

router.get('/divisiones/validas', (req, res) => {
  const { empresa } = req.query;
  res.json({ ok: true, data: getDivisionesValidas(empresa || null) });
});

router.put('/divisiones/:codigo', requireAdmin, async (req, res) => {
  try {
    let codigo = decodeURIComponent(req.params.codigo);
    if (!getVehiculoPorCodigo(codigo)) {
      const porPatente = getVehiculoPorPatente(codigo);
      if (porPatente) codigo = porPatente.codigo;
    }
    const { division, subgrupo } = req.body;
    const resultado = await setDivision(codigo, division, subgrupo);
    res.json({ ok: true, data: resultado });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Configuracion dinamica de divisiones ─────────────────────────────────────

router.post('/divisiones/config', async (req, res) => {
  try {
    const { nombre, empresa } = req.body;
    if (!empresa) return res.status(400).json({ ok: false, error: 'Empresa requerida' });
    const result = await agregarDivision(nombre, empresa);
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/divisiones/config/:nombre', async (req, res) => {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const empresa = req.query.empresa;
    if (!empresa) return res.status(400).json({ ok: false, error: 'Empresa requerida' });

    // Verificar que no haya equipos de ESTA empresa asignados a la division
    const vehiculosEmpresa = getVehiculos(empresa);
    const equiposConDivision = vehiculosEmpresa.filter(v => v.division === nombre);
    if (equiposConDivision.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `No se puede eliminar "${nombre}": tiene ${equiposConDivision.length} equipo(s) asignado(s) en ${empresa}.`,
      });
    }

    const result = await eliminarDivision(nombre, empresa);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/divisiones/config/:division/subdivisiones', async (req, res) => {
  try {
    const division = decodeURIComponent(req.params.division);
    const { nombre, empresa } = req.body;
    if (!empresa) return res.status(400).json({ ok: false, error: 'Empresa requerida' });
    const result = await agregarSubdivision(division, nombre, empresa);
    res.status(201).json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.delete('/divisiones/config/:division/subdivisiones/:nombre', async (req, res) => {
  try {
    const division = decodeURIComponent(req.params.division);
    const nombre = decodeURIComponent(req.params.nombre);
    const empresa = req.query.empresa;
    if (!empresa) return res.status(400).json({ ok: false, error: 'Empresa requerida' });
    const result = await eliminarSubdivision(division, nombre, empresa);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});


// ── Rutas conocidas ─────────────────────────────────────────────────────────

import { getRutasConocidas, getTiempoEstimado, recalcularEstadisticasRutas } from './modules/viajes/rutas.js';

router.get('/rutas-conocidas', (req, res) => {
  res.json({ ok: true, data: getRutasConocidas() });
});

router.get('/rutas/tiempo-estimado', (req, res) => {
  const { origenId, destinoId } = req.query;
  if (!origenId || !destinoId) return res.status(400).json({ ok: false, error: 'origenId y destinoId requeridos' });
  const est = getTiempoEstimado(Number(origenId), Number(destinoId));
  res.json({ ok: true, data: est });
});

router.post('/rutas/recalcular', requireAdmin, async (req, res) => {
  const result = await recalcularEstadisticasRutas();
  res.json({ ok: true, ...result });
});

// ── Alertas ─────────────────────────────────────────────────────────────────

router.get('/alertas', requireEmpresa, async (req, res) => {
  try {
    const { tipo, codigoEquipo, empresa, division, geocerca, desde, hasta, leida, page, pageSize } = req.query;
    const result = await getAlertas({
      tipo, codigoEquipo, empresa, division, geocerca, desde, hasta, leida,
      page:     parseInt(page)     || 1,
      pageSize: parseInt(pageSize) || 50,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/alertas/resumen', requireEmpresa, async (req, res) => {
  try {
    const { empresa, desde, hasta } = req.query;
    const resumen = await getResumenAlertas({ empresa, desde, hasta });
    res.json({ ok: true, data: resumen });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/alertas/ranking', requireEmpresa, async (req, res) => {
  try {
    const { empresa, desde, hasta, tipo } = req.query;
    const data = await getRankingAlertas({ empresa, desde, hasta, tipo });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/alertas/config', (req, res) => {
  res.json({ ok: true, data: getAlertasConfig() });
});

router.post('/alertas/marcar-leidas', async (req, res) => {
  try {
    const { ids } = req.body;
    if (ids === 'all') {
      const count = await marcarTodasLeidas();
      res.json({ ok: true, marcadas: count });
    } else if (Array.isArray(ids)) {
      const count = await marcarLeidas(ids);
      res.json({ ok: true, marcadas: count });
    } else {
      res.status(400).json({ ok: false, error: 'Se espera { ids: number[] | "all" }' });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 404 catch-all ────────────────────────────────────────────────────────────

router.use((req, res) => {
  res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

export default router;
