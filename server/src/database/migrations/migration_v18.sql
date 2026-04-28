-- migration_v18.sql
-- Sincronizacion de asignaciones equipo -> unidad de negocio desde Equipos.
-- Equipos es la fuente de verdad: cada activo (vehiculo, maquina, etc) tiene
-- una unidad y una subdivision asignadas. FleetOps los necesita para filtrar
-- viajes por unidad y mostrar el equipo correcto en cada pantalla.
--
-- Como Equipos hoy NO esta sincronizado con el Hub (catalogos divergentes),
-- guardamos los nombres tal como vienen de Equipos. El cruce con
-- fleetops_unidades_negocio (Hub) se hace por nombre cuando hace falta.

CREATE TABLE IF NOT EXISTS fleetops_equipo_asignacion (
  codigo_equipo            VARCHAR(50)  NOT NULL PRIMARY KEY,
  patente                  VARCHAR(30)  NULL,
  unidad_negocio_id        INT          NULL,    -- ID en Equipos (no en Hub)
  unidad_negocio_nombre    VARCHAR(120) NULL,
  subdivision_id           INT          NULL,
  subdivision_nombre       VARCHAR(120) NULL,
  estado                   VARCHAR(30)  NULL,
  empresa_id               INT          NULL,
  empresa_codigo           VARCHAR(20)  NULL,
  sincronizado_en          TIMESTAMP    NULL,
  INDEX idx_unidad         (unidad_negocio_nombre),
  INDEX idx_patente        (patente)
);
