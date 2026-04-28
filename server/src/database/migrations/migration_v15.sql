-- migration_v15.sql
-- duracion_min era SMALLINT (max 32767 min ~22 dias). Algunos viajes
-- libres "zombies" (en_curso/en_transito desde hace mas de un mes)
-- desbordan ese rango cuando cerrarViajesAbandonados intenta calcular
-- TIMESTAMPDIFF(MINUTE, timestamp_inicio, NOW()).
-- INT cubre hasta ~4000 anios.

ALTER TABLE fleetops_viajes_libres
  MODIFY COLUMN duracion_min INT NULL;
