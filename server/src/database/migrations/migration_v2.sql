-- ══════════════════════════════════════════════════════════════════════════════
-- FleetOPS — Migración v2
-- Cambios:
--   1. Agrega columna codigo_equipo (idgps) a viajes libres y programados
--   2. Índices de apoyo para consultas históricas por rango de fechas
--
-- Ejecutar con:
--   docker exec -i fleetops_db mysql -ufleetops -pfleetops_2024 fleetops < migration_v2.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- ── 1. Agregar codigo_equipo a viajes_libres ──────────────────────────────────
-- Permite identificar equipos sin patente (solo tienen idgps en RedGPS)
ALTER TABLE fleetops_viajes_libres
  ADD COLUMN codigo_equipo VARCHAR(20) NULL
    COMMENT 'Código GPS (idgps) del equipo — útil cuando no hay patente'
    AFTER patente;

-- ── 2. Agregar codigo_equipo a viajes_programados ─────────────────────────────
ALTER TABLE fleetops_viajes_programados
  ADD COLUMN codigo_equipo VARCHAR(20) NULL
    COMMENT 'Código GPS (idgps) del equipo — útil cuando no hay patente'
    AFTER patente;

-- ── 3. Índices adicionales para consultas históricas ─────────────────────────
-- El histórico filtra frecuentemente por rango de fechas + patente/equipo
ALTER TABLE fleetops_viajes_libres
  ADD KEY idx_ts_fin       (timestamp_fin),
  ADD KEY idx_equipo       (codigo_equipo);

ALTER TABLE fleetops_viajes_programados
  ADD KEY idx_equipo       (codigo_equipo),
  ADD KEY idx_fecha_estado (fecha_inicio, cancelado);

-- ── Verificación ──────────────────────────────────────────────────────────────
SELECT
  table_name,
  column_name,
  column_type,
  is_nullable,
  column_comment
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('fleetops_viajes_libres', 'fleetops_viajes_programados')
  AND column_name = 'codigo_equipo'
ORDER BY table_name;
