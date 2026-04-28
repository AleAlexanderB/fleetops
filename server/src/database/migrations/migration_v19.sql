-- migration_v19.sql
-- El codigo de un activo en Equipos viene como 'AB-EQ-A002', pero el codigo
-- que usa FleetOps (heredado de RedGPS) es 'A002' sin el prefijo. El match
-- entre ambos sistemas es por la parte limpia.
--
-- Cambios:
--   * codigo_interno: nueva columna que guarda el original 'AB-EQ-A002'
--   * codigo_equipo: pasa a ser SOLO la parte limpia 'A002'
--   * UPDATE one-shot que normaliza las filas existentes (idempotente)

ALTER TABLE fleetops_equipo_asignacion
  ADD COLUMN codigo_interno VARCHAR(50) NULL AFTER codigo_equipo;

ALTER TABLE fleetops_equipo_asignacion
  ADD INDEX idx_codigo_interno (codigo_interno);

UPDATE fleetops_equipo_asignacion
   SET codigo_interno = codigo_equipo,
       codigo_equipo  = REPLACE(codigo_equipo, 'AB-EQ-', '')
 WHERE codigo_equipo LIKE 'AB-EQ-%'
   AND codigo_interno IS NULL;
