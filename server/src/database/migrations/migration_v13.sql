-- migration_v13.sql
-- Agrega campo tiempo_en_destino_min a viajes programados
-- Representa el tiempo que el vehiculo estara detenido en destino (ej: descarga)

ALTER TABLE fleetops_viajes_programados ADD COLUMN tiempo_en_destino_min INT DEFAULT 60 AFTER hora_llegada_estimada;
