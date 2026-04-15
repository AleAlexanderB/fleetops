-- ══════════════════════════════════════════════════════════════════════════════
-- FleetOPS — Migración v1
-- Base de datos: fleetops (MySQL 8.0)
-- Prefijo de tablas: fleetops_*
--
-- Ejecutar con:
--   docker exec -i fleetops_db mysql -ufleetops -pfleetops_2024 fleetops < migration_v1.sql
-- ══════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- ── 1. Divisiones ─────────────────────────────────────────────────────────────
-- Asignación local vehículo → división + subgrupo
-- Reemplaza el archivo divisiones.json
CREATE TABLE IF NOT EXISTS fleetops_divisiones (
  id_division          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  patente              VARCHAR(20)      NOT NULL COMMENT 'Patente del vehículo (de RedGPS)',
  division             VARCHAR(50)      NOT NULL COMMENT 'Hormigón | Agregados | Premoldeados | Obras | Logística | Corralón | Taller',
  subgrupo             VARCHAR(100)     NULL      COMMENT 'Solo para división Obras (nombre de la obra)',
  creado_en            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id_division),
  UNIQUE KEY uq_patente (patente),
  KEY idx_division (division),
  KEY idx_subgrupo (subgrupo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Asignación local de vehículos a divisiones operativas';


-- ── 2. Viajes libres ───────────────────────────────────────────────────────────
-- Viajes detectados automáticamente por eventos de geocerca (RedGPS)
CREATE TABLE IF NOT EXISTS fleetops_viajes_libres (
  id_viaje_libre       INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  patente              VARCHAR(20)      NOT NULL,
  chofer               VARCHAR(120)     NULL,
  id_chofer_redgps     INT              NULL COMMENT 'ID del chofer en RedGPS',
  division             VARCHAR(50)      NULL,
  subgrupo             VARCHAR(100)     NULL,

  -- Geocercas (datos de RedGPS al momento del evento)
  id_geocerca_origen   INT              NULL,
  nombre_geocerca_origen VARCHAR(150)   NULL,
  id_geocerca_destino  INT              NULL,
  nombre_geocerca_destino VARCHAR(150)  NULL,

  -- Timing
  timestamp_inicio     DATETIME         NOT NULL,
  timestamp_fin        DATETIME         NULL,
  duracion_min         SMALLINT         NULL COMMENT 'Duración calculada en minutos',
  km_recorridos        DECIMAL(8,2)     NULL,

  -- Estado
  estado               ENUM('en_curso','completado','en_transito','cancelado')
                       NOT NULL DEFAULT 'en_curso',

  -- Auditoría
  creado_en            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id_viaje_libre),
  KEY idx_patente       (patente),
  KEY idx_estado        (estado),
  KEY idx_division      (division),
  KEY idx_ts_inicio     (timestamp_inicio),
  KEY idx_patente_fecha (patente, timestamp_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Viajes detectados automáticamente por eventos de geocerca RedGPS';


-- ── 3. Viajes programados ─────────────────────────────────────────────────────
-- Viajes planificados manualmente por el operador
CREATE TABLE IF NOT EXISTS fleetops_viajes_programados (
  id_viaje_programado  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  patente              VARCHAR(20)      NOT NULL,
  chofer               VARCHAR(120)     NULL,
  division             VARCHAR(50)      NULL,
  subgrupo             VARCHAR(100)     NULL,

  -- Geocercas planificadas
  id_geocerca_origen   INT              NOT NULL,
  nombre_geocerca_origen VARCHAR(150)   NOT NULL,
  id_geocerca_destino  INT              NOT NULL,
  nombre_geocerca_destino VARCHAR(150)  NOT NULL,

  -- Carga / descripción del viaje
  carga                VARCHAR(255)     NULL,

  -- Timing planificado
  fecha_inicio         DATE             NOT NULL,
  hora_inicio          TIME             NOT NULL DEFAULT '08:00:00',

  -- Control
  cancelado            TINYINT(1)       NOT NULL DEFAULT 0,
  observaciones        TEXT             NULL,

  -- Comparación real vs planificado (se completa cuando se detecta el viaje GPS)
  id_viaje_libre       INT UNSIGNED     NULL COMMENT 'FK al viaje libre detectado',
  salida_real          DATETIME         NULL,
  llegada_real         DATETIME         NULL,
  duracion_real_min    SMALLINT         NULL,
  demora_salida_min    SMALLINT         NULL COMMENT 'Positivo = llegó tarde, negativo = llegó antes',
  km_reales            DECIMAL(8,2)     NULL,

  -- Auditoría
  creado_en            DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id_viaje_programado),
  KEY idx_patente       (patente),
  KEY idx_fecha         (fecha_inicio),
  KEY idx_division      (division),
  KEY idx_cancelado     (cancelado),
  KEY fk_viaje_libre    (id_viaje_libre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Viajes planificados por el operador con comparación automática vs GPS';


-- ── 4. Sync log ───────────────────────────────────────────────────────────────
-- Registro de sincronizaciones con RedGPS para auditoría y diagnóstico
CREATE TABLE IF NOT EXISTS fleetops_sync_log (
  id_sync              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  endpoint             VARCHAR(80)      NOT NULL COMMENT 'Ej: getdata, vehicleGetAll, getGeofences',
  resultado            ENUM('ok','error','skip') NOT NULL DEFAULT 'ok',
  registros_procesados SMALLINT UNSIGNED NULL,
  mensaje_error        TEXT             NULL,
  duracion_ms          SMALLINT UNSIGNED NULL,
  ejecutado_en         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id_sync),
  KEY idx_endpoint     (endpoint),
  KEY idx_ejecutado_en (ejecutado_en),
  KEY idx_resultado    (resultado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log de sincronizaciones con RedGPS';


-- ── Verificación final ────────────────────────────────────────────────────────
SELECT
  table_name,
  table_comment,
  table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name LIKE 'fleetops_%'
ORDER BY table_name;
