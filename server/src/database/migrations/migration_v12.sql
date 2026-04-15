-- migration_v12.sql
-- Sistema de autenticacion de usuarios FleetOPS

CREATE TABLE IF NOT EXISTS fleetops_usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  rol ENUM('admin','empresa') NOT NULL DEFAULT 'empresa',
  empresa VARCHAR(100) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_login TIMESTAMP NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
