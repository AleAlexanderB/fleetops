-- Migration v6: Tabla de alertas RedGPS (webhook)
SET NAMES utf8mb4;
SET time_zone = '-03:00';

CREATE TABLE IF NOT EXISTS fleetops_alertas (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo            VARCHAR(50)  NOT NULL COMMENT 'geocerca_ingreso, geocerca_salida, velocidad, ralenti, ignicion_on, ignicion_off, panico, otro',
  codigo_equipo   VARCHAR(20)  NULL COMMENT 'Codigo interno del vehiculo',
  patente         VARCHAR(20)  NULL,
  etiqueta        VARCHAR(80)  NULL COMMENT 'Display: codigo o patente o nombre',
  empresa         VARCHAR(100) NULL,
  division        VARCHAR(50)  NULL,
  descripcion     TEXT         NULL COMMENT 'Descripcion original de RedGPS',
  geocerca        VARCHAR(100) NULL COMMENT 'Nombre geocerca (si aplica)',
  latitud         DECIMAL(10,6) NULL,
  longitud        DECIMAL(10,6) NULL,
  velocidad       DECIMAL(6,1) NULL,
  conductor       VARCHAR(100) NULL,
  timestamp_alerta DATETIME    NOT NULL COMMENT 'Fecha/hora de la alerta',
  creado_en       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  leida           TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_tipo (tipo),
  INDEX idx_equipo (codigo_equipo),
  INDEX idx_timestamp (timestamp_alerta),
  INDEX idx_leida (leida),
  INDEX idx_tipo_ts (tipo, timestamp_alerta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
