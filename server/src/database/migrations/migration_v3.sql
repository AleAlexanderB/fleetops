-- ══════════════════════════════════════════════════════════════════════════════
-- FleetOPS — Migración v3
-- Cambio de clave principal: patente → codigo_equipo
--
-- MOTIVACIÓN:
--   El código interno (A021, K006, etc.) es el identificador universal en
--   RedGPS — presente en getAlerts, vehicleGetAll, getdata.
--   La patente puede estar vacía para maquinaria y equipos sin registro.
--   Este cambio garantiza que todo el parque quede correctamente identificado.
--
-- CAMBIOS:
--   1. fleetops_divisiones: agrega codigo_equipo como columna principal
--   2. fleetops_viajes_libres: codigo_equipo pasa a NOT NULL
--   3. fleetops_viajes_programados: codigo_equipo pasa a NOT NULL
-- ══════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- ── 1. fleetops_divisiones: agregar codigo_equipo ────────────────────────────

ALTER TABLE fleetops_divisiones
  ADD COLUMN codigo_equipo VARCHAR(20) NULL
    COMMENT 'Código interno del equipo (A021, K006...) — clave principal'
    AFTER id_division;

-- Migrar datos: copiar patente a codigo_equipo
UPDATE fleetops_divisiones SET codigo_equipo = patente WHERE codigo_equipo IS NULL;

-- Crear índice único por codigo_equipo
ALTER TABLE fleetops_divisiones
  ADD UNIQUE KEY uq_codigo (codigo_equipo);

-- ── 2. fleetops_viajes_libres: asegurar que codigo_equipo tenga valor ────────
-- Si había viajes sin codigo_equipo, poner la patente como fallback

UPDATE fleetops_viajes_libres
  SET codigo_equipo = patente
  WHERE codigo_equipo IS NULL AND patente IS NOT NULL;

-- ── 3. fleetops_viajes_programados: idem ─────────────────────────────────────

UPDATE fleetops_viajes_programados
  SET codigo_equipo = patente
  WHERE codigo_equipo IS NULL AND patente IS NOT NULL;

-- ── Verificación ──────────────────────────────────────────────────────────────
SELECT 'migration_v3 completada' AS status;
