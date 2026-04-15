-- Migration v7: Divisiones por empresa
SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- Agregar columna empresa a la tabla de config de divisiones
ALTER TABLE fleetops_config_divisiones
  ADD COLUMN empresa VARCHAR(100) NOT NULL DEFAULT '' AFTER id;

-- Quitar el unique de solo division (ahora es division+empresa)
ALTER TABLE fleetops_config_divisiones
  DROP INDEX uq_division;

-- Nuevo unique: empresa + division
ALTER TABLE fleetops_config_divisiones
  ADD UNIQUE INDEX uq_empresa_division (empresa, division);

-- Las divisiones existentes son de Corralon el Mercado (la empresa original)
UPDATE fleetops_config_divisiones SET empresa = 'Corralon el Mercado' WHERE empresa = '';

-- Clonar las mismas divisiones para VIAP como punto de partida
INSERT IGNORE INTO fleetops_config_divisiones (empresa, division, subdivisiones)
  SELECT 'VIAP', division, '[]' FROM fleetops_config_divisiones WHERE empresa = 'Corralon el Mercado';
