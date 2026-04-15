-- ══════════════════════════════════════════════════════════════════════════════
-- FleetOPS — Migración v4
-- Cierre definitivo de la migración patente → codigo_equipo
--
-- CAMBIOS:
--   1. patente pasa a NULL en las 3 tablas principales
--   2. codigo_equipo pasa a NOT NULL en viajes_libres y viajes_programados
--   3. Índices actualizados para reflejar la nueva clave principal
--
-- IMPORTANTE: migration_v3 ya migró los datos (copió patente a codigo_equipo
-- donde faltaba). Esta migración solo cambia las constraints.
-- ══════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- ── 1. fleetops_divisiones ───────────────────────────────────────────────────

-- patente pasa a nullable (maquinaria puede no tener patente)
ALTER TABLE fleetops_divisiones MODIFY patente VARCHAR(20) NULL;

-- codigo_equipo pasa a NOT NULL (ya fue poblado en v3)
ALTER TABLE fleetops_divisiones MODIFY codigo_equipo VARCHAR(20) NOT NULL;

-- ── 2. fleetops_viajes_libres ────────────────────────────────────────────────

-- patente pasa a nullable
ALTER TABLE fleetops_viajes_libres MODIFY patente VARCHAR(20) NULL;

-- codigo_equipo pasa a NOT NULL
ALTER TABLE fleetops_viajes_libres MODIFY codigo_equipo VARCHAR(20) NOT NULL;

-- Reemplazar índice compuesto basado en patente
ALTER TABLE fleetops_viajes_libres DROP KEY idx_patente_fecha;
ALTER TABLE fleetops_viajes_libres ADD KEY idx_equipo_fecha (codigo_equipo, timestamp_inicio);

-- ── 3. fleetops_viajes_programados ───────────────────────────────────────────

-- patente pasa a nullable
ALTER TABLE fleetops_viajes_programados MODIFY patente VARCHAR(20) NULL;

-- codigo_equipo pasa a NOT NULL
ALTER TABLE fleetops_viajes_programados MODIFY codigo_equipo VARCHAR(20) NOT NULL;

-- ── Verificación ──────────────────────────────────────────────────────────────
SELECT 'migration_v4 completada — codigo_equipo es NOT NULL en todas las tablas' AS status;
