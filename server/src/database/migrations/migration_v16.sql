-- migration_v16.sql
-- Sync de usuarios desde el Hub. Agrega:
--   id_externo:        ID del usuario en el Hub (matching idempotente al sincronizar)
--   sincronizado_en:   timestamp de la ultima sincro
--   email:             el username actual es libre, agregamos email como
--                      fuente de verdad (el Hub usa email como identidad)
-- Tambien afloja password_hash a NULL: usuarios sincronizados desde el Hub
-- no tienen password local — solo SSO via Hub. Los usuarios locales pre-existentes
-- (admin, corralon, viap) mantienen su password_hash y siguen funcionando.

ALTER TABLE fleetops_usuarios
  ADD COLUMN IF NOT EXISTS id_externo      INT NULL UNIQUE      AFTER id,
  ADD COLUMN IF NOT EXISTS sincronizado_en TIMESTAMP NULL       AFTER ultimo_login,
  ADD COLUMN IF NOT EXISTS email           VARCHAR(160) NULL    AFTER username,
  MODIFY COLUMN password_hash VARCHAR(255) NULL;

-- Indices para acelerar matching desde el sync
ALTER TABLE fleetops_usuarios
  ADD INDEX IF NOT EXISTS idx_email      (email);

-- Tabla auxiliar para registrar el estado de cada sincronizacion.
-- Una fila por origen ('hub_usuarios', 'hub_unidades_negocio',
-- 'hub_familias', 'equipos_activos', etc).
CREATE TABLE IF NOT EXISTS fleetops_sync_status (
  origen           VARCHAR(60)  PRIMARY KEY,
  sincronizado_en  TIMESTAMP    NULL,
  ok               TINYINT(1)   NOT NULL DEFAULT 0,
  cantidad         INT          NULL,
  error            VARCHAR(500) NULL,
  actualizado_en   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP
);
