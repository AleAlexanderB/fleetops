-- migration_v14.sql
-- Agrega 'abandonado' al ENUM de estado de viajes libres.
-- Un viaje libre se marca abandonado cuando paso demasiado tiempo
-- en estado en_curso/en_transito sin llegar a destino, para destrabar
-- los programados vinculados a libres zombies.

ALTER TABLE fleetops_viajes_libres
  MODIFY COLUMN estado ENUM('en_curso','completado','en_transito','cancelado','abandonado')
  NOT NULL DEFAULT 'en_curso';
