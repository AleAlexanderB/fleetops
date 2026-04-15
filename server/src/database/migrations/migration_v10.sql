-- migration_v10.sql
-- Agrega campos de llegada estimada y motivo de cancelacion a viajes programados

ALTER TABLE fleetops_viajes_programados ADD COLUMN fecha_llegada_estimada DATE NULL AFTER hora_inicio;
ALTER TABLE fleetops_viajes_programados ADD COLUMN hora_llegada_estimada VARCHAR(8) NULL AFTER fecha_llegada_estimada;
ALTER TABLE fleetops_viajes_programados ADD COLUMN motivo_cancelacion TEXT NULL AFTER observaciones;
