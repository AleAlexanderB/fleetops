-- migration_v16.sql
-- Sync de usuarios desde el Hub.
-- IF NOT EXISTS no es MySQL puro (es MariaDB); el migrate.js ya tolera
-- ER_DUP_FIELDNAME / ER_DUP_KEYNAME en re-runs, asi que cada ALTER va plano.

ALTER TABLE fleetops_usuarios ADD COLUMN id_externo INT NULL UNIQUE AFTER id;
ALTER TABLE fleetops_usuarios ADD COLUMN sincronizado_en TIMESTAMP NULL AFTER ultimo_login;
ALTER TABLE fleetops_usuarios ADD COLUMN email VARCHAR(160) NULL AFTER username;
ALTER TABLE fleetops_usuarios MODIFY COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE fleetops_usuarios ADD INDEX idx_email (email);

-- Tabla auxiliar para registrar el estado de cada sincronizacion.
CREATE TABLE IF NOT EXISTS fleetops_sync_status (
  origen           VARCHAR(60)  PRIMARY KEY,
  sincronizado_en  TIMESTAMP    NULL,
  ok               TINYINT(1)   NOT NULL DEFAULT 0,
  cantidad         INT          NULL,
  error            VARCHAR(500) NULL,
  actualizado_en   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP
);
