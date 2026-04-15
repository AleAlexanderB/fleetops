-- Migration v8: Rutas conocidas (distancias reales aprendidas) + campos de progreso en viajes programados
SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- Tabla de rutas conocidas: origen → destino → distancia real
CREATE TABLE IF NOT EXISTS fleetops_rutas_conocidas (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_geocerca_origen  INT UNSIGNED NOT NULL,
  nombre_origen       VARCHAR(100) NOT NULL,
  id_geocerca_destino INT UNSIGNED NOT NULL,
  nombre_destino      VARCHAR(100) NOT NULL,
  distancia_km        DECIMAL(8,2) NOT NULL COMMENT 'Distancia real GPS en km',
  duracion_avg_min    INT UNSIGNED NULL COMMENT 'Duracion promedio en minutos',
  cantidad_viajes     INT UNSIGNED NOT NULL DEFAULT 1,
  ultima_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ruta (id_geocerca_origen, id_geocerca_destino)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agregar distancia estimada al viaje programado
ALTER TABLE fleetops_viajes_programados
  ADD COLUMN distancia_estimada_km DECIMAL(8,2) NULL COMMENT 'Distancia estimada de la ruta (OSRM o historica)' AFTER km_reales;

ALTER TABLE fleetops_viajes_programados
  ADD COLUMN fuente_distancia VARCHAR(20) NULL COMMENT 'osrm, historica, o null' AFTER distancia_estimada_km;
