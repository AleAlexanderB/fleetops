-- Geocercas temporales para viajes programados
CREATE TABLE IF NOT EXISTS fleetops_geocercas_temp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  latitud DOUBLE NOT NULL,
  longitud DOUBLE NOT NULL,
  radio INT NOT NULL DEFAULT 200,
  viaje_programado_id INT NULL,
  tipo ENUM('origen','destino') NOT NULL DEFAULT 'destino',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activo (activo),
  INDEX idx_viaje (viaje_programado_id)
);

-- Add columns to viajes_programados for custom points
ALTER TABLE fleetops_viajes_programados ADD COLUMN origen_lat DOUBLE NULL;
ALTER TABLE fleetops_viajes_programados ADD COLUMN origen_lng DOUBLE NULL;
ALTER TABLE fleetops_viajes_programados ADD COLUMN origen_radio INT NULL;
ALTER TABLE fleetops_viajes_programados ADD COLUMN destino_lat DOUBLE NULL;
ALTER TABLE fleetops_viajes_programados ADD COLUMN destino_lng DOUBLE NULL;
ALTER TABLE fleetops_viajes_programados ADD COLUMN destino_radio INT NULL;
