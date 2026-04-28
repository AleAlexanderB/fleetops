-- migration_v17.sql
-- Tablas locales para sincronizacion de catalogos desde el Hub.
-- El Hub es la fuente unica de verdad de unidades de negocio y categorias
-- (familias). FleetOps mantiene una copia para resilencia y consultas
-- rapidas; el sync corre cada 10 min via /api/v1/unidades-negocio.

CREATE TABLE IF NOT EXISTS fleetops_unidades_negocio (
  id_externo       INT          NOT NULL PRIMARY KEY,   -- ID en el Hub
  nombre           VARCHAR(120) NOT NULL,
  codigo           VARCHAR(40)  NULL,
  descripcion      VARCHAR(255) NULL,
  activa           TINYINT(1)   NOT NULL DEFAULT 1,
  orden            INT          NULL,
  sincronizado_en  TIMESTAMP    NULL,
  INDEX idx_codigo (codigo),
  INDEX idx_nombre (nombre)
);

CREATE TABLE IF NOT EXISTS fleetops_familias (
  id_externo                INT          NOT NULL PRIMARY KEY,
  unidad_negocio_id_externo INT          NOT NULL,
  nombre                    VARCHAR(120) NOT NULL,
  codigo                    VARCHAR(40)  NULL,
  tipo                      VARCHAR(30)  NULL,
  activa                    TINYINT(1)   NOT NULL DEFAULT 1,
  sincronizado_en           TIMESTAMP    NULL,
  INDEX idx_unidad (unidad_negocio_id_externo),
  INDEX idx_nombre (nombre)
);
