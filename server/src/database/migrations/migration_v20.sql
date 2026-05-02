-- migration_v20.sql
-- Tracking de tiempo real de descarga en viajes programados.
-- Cuando el camion sale de la geocerca destino (= inicia un nuevo viaje libre
-- desde esa geocerca), se marca salida_destino_real y se calcula descarga_real_min.

ALTER TABLE fleetops_viajes_programados
  ADD COLUMN salida_destino_real DATETIME NULL AFTER llegada_real;

ALTER TABLE fleetops_viajes_programados
  ADD COLUMN descarga_real_min INT NULL AFTER salida_destino_real;
