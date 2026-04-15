-- Migration v5: Configuración dinámica de divisiones y subdivisiones
SET NAMES utf8mb4;
SET time_zone = '-03:00';

CREATE TABLE IF NOT EXISTS fleetops_config_divisiones (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  division    VARCHAR(50) NOT NULL COMMENT 'Nombre de la división',
  subdivisiones JSON NULL COMMENT 'Array JSON de subdivisiones',
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_division (division)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed con las divisiones iniciales
INSERT IGNORE INTO fleetops_config_divisiones (division, subdivisiones) VALUES
  ('Hormigón', '[]'),
  ('Agregados', '[]'),
  ('Premoldeados', '[]'),
  ('Obras', '[]'),
  ('Logística', '[]'),
  ('Corralón', '[]'),
  ('Taller', '[]');
