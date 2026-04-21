# PLAN DE MIGRACIÓN — BDs separadas + Usuarios centralizados en Hub

> **Propósito:** Documentar los dos trabajos grandes que llevan el ecosistema al modelo arquitectónico objetivo. Hoy FleetOPS y Activos comparten BD (`fleetops`) con prefijos y cada uno gestiona sus propios usuarios. El objetivo es: cada módulo en su propia BD, usuarios únicos en el Hub.
> **Audiencia:** Alejandro + dev técnico que ejecute las migraciones.
> **Última actualización:** Abril 2026
> **Estado:** Plan aprobado, pendiente de ejecución.

---

## Resumen de las migraciones

| Migración | Riesgo | Tiempo estimado | Dependencias |
|-----------|--------|-----------------|--------------|
| **M1** — Separar BD `activos` de `fleetops` | Medio (toca prod) | 2-3 horas + ventana | Ninguna previa |
| **M2** — Usuarios centralizados en Hub + Configuración General | Alto (cambia auth de todos los módulos) | 1-2 semanas de dev + ventana de deploy | M1 completada (o independiente, pero recomendado) |
| **M3** — Vinculaciones externas (RedGPS / Cintelink / Pajet) en Activos | Bajo (nueva tabla + script de backfill) | 2-3 días de dev | Preferible después de M1 |

**Orden recomendado:** M1 → M3 → M2. M3 es de bajo riesgo y desbloquea la identidad única de activos entre sistemas, fundamental para los módulos que dependen del mapping.

---

## M1 — Separar BD `activos` de `fleetops`

### Estado actual
- Instancia MySQL única en contenedor `fleetops_db`.
- BD `fleetops` contiene tablas de dos módulos: `fleetops_*` (FleetOPS) y `equipos_*` (Activos).
- Activos usa `DATABASE_URL=mysql://equipos_user:***@fleetops_db:3306/fleetops`.
- Usuario `equipos_user` tiene `GRANT ALL ON fleetops.equipos_%`.

### Estado objetivo
- Misma instancia MySQL (`fleetops_db`).
- **BD nueva `activos`** con todas las tablas de Activos (renombradas sin prefijo `equipos_`).
- Usuario `activos_user` con `GRANT ALL ON activos.*`.
- Activos apunta a `DATABASE_URL=mysql://activos_user:***@fleetops_db:3306/activos`.
- Usuario `equipos_user` y BD `fleetops` solo contienen lo de FleetOPS.

### Pasos de ejecución

**Preparación (sin impacto en prod):**
1. Generar contraseña fuerte para `activos_user` y agregar a `SECRETOS.md`.
2. Adaptar `schema.prisma` de Activos: cambiar los `@@map("equipos_xxx")` a `@@map("xxx")` (o mantener, ver decisión abajo).
3. Decidir: ¿renombrar tablas quitando prefijo `equipos_` o mantenerlo? **Recomendación:** quitar prefijo porque la BD misma ya identifica al módulo. Pero si el esfuerzo de re-testear Prisma es alto, se puede mantener y hacer el rename en una iteración posterior.
4. Preparar script SQL de migración (ver `migracion-m1.sql` abajo).
5. Probar el script en un entorno local con un dump reciente de producción.

**Ventana de mantenimiento (Activos offline ~30 min):**
1. Backup completo manual de la BD `fleetops` (con todas las tablas `equipos_*`):
   ```bash
   docker exec fleetops_db mysqldump -u root -p<ROOT_PASS> --single-transaction --routines --triggers fleetops > /opt/fleetops/backups/pre-m1-$(date +%Y%m%d_%H%M).sql
   ```
2. Detener Activos: `docker compose stop equipos`.
3. Crear BD `activos` y usuario `activos_user`:
   ```sql
   CREATE DATABASE activos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'activos_user'@'%' IDENTIFIED BY '<PASS_SEGURO>';
   GRANT ALL PRIVILEGES ON activos.* TO 'activos_user'@'%';
   FLUSH PRIVILEGES;
   ```
4. Mover tablas (opción A — mantener prefijo):
   ```sql
   RENAME TABLE fleetops.equipos_activos TO activos.equipos_activos;
   RENAME TABLE fleetops.equipos_usuarios TO activos.equipos_usuarios;
   -- ... (todas las tablas equipos_*)
   ```
   O mover tablas (opción B — quitar prefijo, recomendado):
   ```sql
   RENAME TABLE fleetops.equipos_activos TO activos.activos;
   RENAME TABLE fleetops.equipos_usuarios TO activos.usuarios;
   -- ... ajustar schema.prisma en consecuencia
   ```
5. Revocar privilegios antiguos:
   ```sql
   REVOKE ALL PRIVILEGES ON fleetops.* FROM 'equipos_user'@'%';
   DROP USER 'equipos_user'@'%';  -- o mantener sin permisos por ahora
   FLUSH PRIVILEGES;
   ```
6. Actualizar `.env` del VPS con nuevo `DATABASE_URL` de Activos:
   ```
   EQUIPOS_DATABASE_URL=mysql://activos_user:<PASS>@fleetops_db:3306/activos
   ```
7. Actualizar `docker-compose.yml` si el nombre de la variable cambió.
8. Si se eligió opción B, hacer deploy de nueva versión de Activos con `schema.prisma` actualizado.
9. Levantar Activos: `docker compose up -d equipos`.
10. Smoke test: login, dashboard, CRUD de un activo, carga de combustible.

**Rollback si algo falla:**
- Detener Activos.
- Restaurar el dump: `mysql -u root -p fleetops < /opt/fleetops/backups/pre-m1-<timestamp>.sql`.
- Volver al `.env` anterior.
- Levantar Activos con la imagen previa.

### Checklist M1

- [ ] Script de migración probado en local.
- [ ] Password de `activos_user` agregada a `SECRETOS.md`.
- [ ] Backup manual pre-migración hecho.
- [ ] BD `activos` creada.
- [ ] Tablas movidas.
- [ ] `.env` del VPS actualizado.
- [ ] Activos levantado y respondiendo en :8078.
- [ ] Smoke test pasa.
- [ ] Backup script actualizado para incluir la nueva BD `activos`.
- [ ] `REVOKE` y `DROP USER` del usuario `equipos_user` ejecutados.
- [ ] Documentación `05-DEPLOYMENT-ACTUAL.md` actualizada con el nuevo estado.

---

## M2 — Usuarios centralizados en Hub + Configuración General

### Estado actual
- FleetOPS autentica contra `fleetops_usuarios` (BD `fleetops`, username + password bcrypt).
- Activos autentica contra `equipos_usuarios` (BD `activos` post-M1, email + password bcrypt, rol enum).
- Hub no tiene BD propia; solo genera JWT y lo pasa por URL.
- Un usuario real que trabaja en ambos módulos tiene dos cuentas separadas.

### Estado objetivo
- BD `hub` con tabla `hub_usuarios` (única fuente de verdad).
- Tabla `hub_permisos` con la matriz usuario × módulo × rol.
- Tabla `hub_empresas` centralizada.
- Cada módulo **no tiene tabla de usuarios propia**. Valida JWT del Hub y consulta al Hub si necesita datos de usuario o verificar permisos.
- **Módulo "Configuración General"**: UI admin dentro del Hub para CRUD de usuarios, empresas y matriz de permisos. Accesible solo para role `admin` global.

### Diseño de tablas en BD `hub`

```sql
CREATE TABLE hub_usuarios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(180) UNIQUE NOT NULL,
  nombre        VARCHAR(180) NOT NULL,
  password      VARCHAR(255) NOT NULL,  -- bcrypt
  activo        BOOLEAN DEFAULT TRUE,
  es_admin_global BOOLEAN DEFAULT FALSE,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL
);

CREATE TABLE hub_empresas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  codigo        VARCHAR(20) UNIQUE NOT NULL,
  nombre        VARCHAR(180) NOT NULL,
  nombre_corto  VARCHAR(40),
  activo        BOOLEAN DEFAULT TRUE,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL
);

CREATE TABLE hub_usuario_empresas (
  usuario_id    INT NOT NULL,
  empresa_id    INT NOT NULL,
  PRIMARY KEY (usuario_id, empresa_id),
  FOREIGN KEY (usuario_id) REFERENCES hub_usuarios(id),
  FOREIGN KEY (empresa_id) REFERENCES hub_empresas(id)
);

CREATE TABLE hub_permisos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id    INT NOT NULL,
  modulo        VARCHAR(40) NOT NULL,  -- 'fleetops', 'activos', 'hub', ...
  rol           VARCHAR(40) NOT NULL,  -- 'admin', 'operador', 'consulta', o roles específicos del módulo
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES hub_usuarios(id),
  UNIQUE KEY (usuario_id, modulo)
);

CREATE TABLE hub_sesiones (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id    INT NOT NULL,
  token_hash    VARCHAR(128) NOT NULL,
  expires_at    DATETIME NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address    VARCHAR(45),
  user_agent    TEXT,
  FOREIGN KEY (usuario_id) REFERENCES hub_usuarios(id)
);

CREATE TABLE hub_audit_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id    INT,
  accion        VARCHAR(60) NOT NULL,     -- 'login', 'crear_usuario', 'cambiar_permiso', ...
  modulo        VARCHAR(40),
  entidad       VARCHAR(60),
  entidad_id    INT,
  payload_antes JSON,
  payload_despues JSON,
  ip_address    VARCHAR(45),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES hub_usuarios(id)
);
```

### Payload del JWT del Hub

```json
{
  "userId": 42,
  "email": "alejandro@ab.com",
  "nombre": "Alejandro Barrios",
  "esAdminGlobal": true,
  "empresas": [1, 2, 3, 4, 5],
  "permisos": {
    "fleetops": "admin",
    "activos": "admin",
    "hub": "admin"
  },
  "iat": 1712345678,
  "exp": 1712432078
}
```

Cada módulo lee `permisos[<nombre_modulo>]` para saber el rol del usuario en ese módulo. Si no existe, el usuario no tiene acceso.

### Endpoints del Hub a implementar

| Método | Path | Descripción | Permiso |
|--------|------|-------------|---------|
| `POST` | `/api/auth/login` | Login con email+password, retorna JWT | público |
| `POST` | `/api/auth/logout` | Invalida sesión | autenticado |
| `GET` | `/api/auth/me` | Usuario actual según JWT | autenticado |
| `GET` | `/api/usuarios/:id` | Datos del usuario (sin password) | admin global o el mismo usuario |
| `GET` | `/api/permisos/:userId/:modulo` | Permisos del usuario en un módulo | autenticado |
| `GET` | `/api/usuarios` | Lista de usuarios | admin global |
| `POST` | `/api/usuarios` | Crear usuario | admin global |
| `PUT` | `/api/usuarios/:id` | Editar usuario | admin global |
| `DELETE` | `/api/usuarios/:id` | Soft-delete usuario | admin global |
| `POST` | `/api/permisos` | Asignar rol a usuario en módulo | admin global |
| `DELETE` | `/api/permisos/:id` | Revocar permiso | admin global |
| `GET` | `/api/empresas` | Lista de empresas | autenticado |
| `POST` | `/api/empresas` | Crear empresa | admin global |
| `GET` | `/api/audit-log` | Historial de acciones sensibles | admin global |

### Módulo "Configuración General" (UI del Hub)

- Ruta: `http://157.245.219.73/config/` (protegida por JWT del Hub + role admin global).
- Pantallas:
  - **Usuarios**: tabla, crear, editar, activar/desactivar, reset password.
  - **Empresas**: CRUD.
  - **Matriz de permisos**: tabla usuario × módulo, editable.
  - **Auditoría**: log de acciones recientes.
- Stack: React + Vite + Tailwind (consistente con los otros módulos).
- Se sirve desde el mismo contenedor `fleetops_hub` (nginx) o un contenedor nuevo `hub_config` según preferencia.

### Pasos de migración

**Fase 1 — Preparación (no afecta prod):**
1. Crear BD `hub` + tablas.
2. Desarrollar el backend del Hub con los endpoints listados.
3. Desarrollar la UI de Configuración General.
4. Hacer pruebas locales con un seed de usuarios ficticios.

**Fase 2 — Migración de usuarios existentes (script one-off):**
1. Generar script que lea `fleetops.fleetops_usuarios` y `activos.equipos_usuarios` y los consolide en `hub.hub_usuarios`.
2. Para usuarios con el mismo email en ambos módulos: fusionar en un único registro del Hub, con permisos en ambos módulos.
3. Para usuarios que solo existen en un módulo: migrar tal cual, con permisos solo en ese módulo.
4. Los passwords existentes (ya son bcrypt en ambos módulos) se copian tal cual — bcrypt hashes son portables.

**Fase 3 — Adaptación de cada módulo (en orden):**
1. FleetOPS: reemplazar middleware de auth para que valide JWT del Hub y consulte `GET /api/permisos/:userId/fleetops`. Dejar tabla `fleetops_usuarios` solo para compatibilidad de lectura (eventualmente se borra).
2. Activos: misma adaptación contra `/api/permisos/:userId/activos`.
3. Testing end-to-end: login en Hub → navegar a FleetOPS → navegar a Activos. Verificar que permisos se respetan.

**Fase 4 — Deprecación (semanas después):**
1. Monitorear logs para confirmar que nadie intenta loguear vía el endpoint legacy.
2. Desactivar endpoints de login locales en FleetOPS y Activos.
3. Drop de `fleetops_usuarios` y `equipos_usuarios` (con backup previo).

### Checklist M2

- [ ] Backend del Hub con endpoints de auth y usuarios.
- [ ] BD `hub` creada con el schema propuesto.
- [ ] UI de Configuración General funcional.
- [ ] Script de migración de usuarios probado en staging.
- [ ] FleetOPS adaptado para validar JWT del Hub.
- [ ] Activos adaptado para validar JWT del Hub.
- [ ] Smoke test end-to-end: login → FleetOPS → Activos.
- [ ] Tablas de usuarios locales marcadas como deprecated.
- [ ] Drop de tablas locales tras N semanas sin uso.

---

---

## M3 — Vinculaciones externas (RedGPS / Cintelink / Pajet) en Activos

### Problema

Un mismo activo físico tiene hoy **tres identificadores distintos** sin vínculo formal:

1. `codigoInterno` autogenerado por Activos: formato `{empresa}-{CAT}-{letraTipo}{seq:03}` → ej. `AB-EQ-A003`.
2. `codigo` de RedGPS: primera palabra del nombre del vehículo → ej. `A003`.
3. `codigoCintelink` que devuelve Cintelink en cada transacción.

Además se viene Pajet con su propio identificador. Hoy el match se resuelve por coincidencia de string o por el campo libre `gpsId` en la tabla `Activo`, sin auditoría, sin historia y sin posibilidad de múltiples vínculos.

### Decisiones tomadas

1. **Dueño del mapping:** Activos. Habrá activos sin GPS (herramientas, inmuebles), así que el dominio natural es la gestión patrimonial, no el Gateway. El Gateway consulta a Activos vía API cuando necesita resolver.
2. **Convivencia de códigos:** `codigoInterno` nuevo (`AB-EQ-A003`) convive con el legacy (`A003`). El legacy se guarda como `codigoExterno` de `REDGPS` en la tabla de vinculaciones — no se fuerza a renombrar nada en RedGPS.
3. **Backfill inicial:** todos los activos hoy vinieron de RedGPS, así que el `codigoInterno` termina con el código legacy (sufijo después del último `-`). Un script matchea `sufijo(codigoInterno) == codigo(RedGPS)` y crea las vinculaciones automáticamente.

### Estado objetivo

Tabla nueva `equipos_vinculaciones_externas` en BD `activos`, con una fila por cada vínculo `(activo, sistema externo)`. Un activo puede tener 0, 1 o varias vinculaciones.

### Schema Prisma

```prisma
model VinculacionExterna {
  id              Int              @id @default(autoincrement())
  activoId        Int
  sistemaExterno  SistemaExterno
  codigoExterno   String           @db.VarChar(60)   // ej: "A003", "B012", código Cintelink
  idExterno       String?          @db.VarChar(60)   // ej: idgps numérico de RedGPS (863457051877338)
  empresaExterna  String?          @db.VarChar(60)   // ej: "corralon", "viap"
  metadata        Json?                              // datos extra del sistema externo
  activo          Boolean          @default(true)
  creadoEn        DateTime         @default(now())
  actualizadoEn   DateTime         @updatedAt

  activoRel       Activo           @relation(fields: [activoId], references: [id], onDelete: Cascade)

  @@unique([sistemaExterno, codigoExterno])
  @@index([activoId])
  @@index([sistemaExterno, idExterno])
  @@map("equipos_vinculaciones_externas")
}

enum SistemaExterno {
  REDGPS
  CINTELINK
  PAJET
}
```

**Relación inversa en `Activo`:**
```prisma
model Activo {
  // ... campos existentes
  vinculaciones VinculacionExterna[]
}
```

**Regla de negocio:** `@@unique([sistemaExterno, codigoExterno])` garantiza que un código externo no puede apuntar a dos activos distintos. Si cambia el vínculo (ej: se reemplaza el equipo físico con el código `A003`), se marca el viejo `activo = false` y se crea uno nuevo.

### Endpoints a implementar (en el backend de Activos)

| Método | Path | Descripción |
|--------|------|-------------|
| `GET` | `/api/vinculaciones?activoId=N` | Lista las vinculaciones de un activo |
| `GET` | `/api/vinculaciones?sistema=REDGPS&codigo=A003` | Busca un vínculo específico |
| `GET` | `/api/vinculaciones/pendientes?sistema=REDGPS` | Activos del sistema externo que aún no fueron vinculados (ej: vehículos en RedGPS sin activo interno asociado) |
| `GET` | `/api/vinculaciones/sin-vincular?sistema=REDGPS` | Activos internos sin vinculación al sistema externo |
| `POST` | `/api/vinculaciones` | Crea un vínculo manual |
| `PUT` | `/api/vinculaciones/:id` | Edita (normalmente para actualizar `metadata` o desactivar) |
| `DELETE` | `/api/vinculaciones/:id` | Soft-delete (`activo = false`) |
| `POST` | `/api/vinculaciones/resolver` | Dado `{ sistema, codigo, idExterno?, patente? }` retorna el activo interno asociado (endpoint que consume el Gateway u otros módulos) |

### Endpoint del Gateway a agregar (opcional pero recomendado)

El Gateway puede cachear el mapping para no hacer un HTTP a Activos en cada evento SSE:

- Al arrancar o cada N minutos, llama a `GET /api/vinculaciones?sistema=REDGPS` de Activos y guarda el dict `{ codigoExterno → activoId }` en memoria.
- Cuando emite un evento SSE, enriquece el payload con `activoId` (`null` si no hay mapping).

### Script de backfill inicial

Archivo: `E:/001-EQUIPOS/server/scripts/backfill-vinculaciones-redgps.js`.

Lógica:
1. `GET http://fleetops_gps_gateway:3100/api/vehicles` → obtener los 181 vehículos actuales.
2. `prisma.activo.findMany({ where: { deleted: false } })` → obtener todos los activos.
3. Para cada activo:
   - Extraer `sufijo = codigoInterno.split('-').pop()` (ej: `AB-EQ-A003` → `A003`).
   - Buscar en la lista del Gateway: `v = vehiculos.find(x => x.codigo === sufijo && x.empresa === mapEmpresa(activo.empresaId))`.
   - Si matchea: `INSERT INTO equipos_vinculaciones_externas (activoId, sistemaExterno, codigoExterno, idExterno, empresaExterna, metadata) VALUES (activo.id, 'REDGPS', v.codigo, v.idgps, v.empresa, { patente: v.patente, nombre: v.nombre, marca: v.marca, modelo: v.modelo })`.
   - Si no matchea: log al reporte de pendientes.
4. Al final, imprimir dos listas:
   - Activos internos sin matching en RedGPS (probable: inmuebles, herramientas, o equipos que no están en RedGPS).
   - Vehículos de RedGPS sin activo interno (probable: equipos viejos, o equipos que hay que importar).

**Ejecución:**
```bash
docker compose exec equipos node scripts/backfill-vinculaciones-redgps.js --dry-run
# Revisar el reporte
docker compose exec equipos node scripts/backfill-vinculaciones-redgps.js --apply
```

### Flujo de uso típico

**Caso 1 — Llega una posición SSE del Gateway:**
1. Gateway emite `{ idgps, codigo: "A003", patente, empresa, ... }` al SSE.
2. (Con cache del Gateway habilitado) payload incluye `activoId: 42`.
3. O, sin cache: el módulo consumidor llama `POST /api/vinculaciones/resolver { sistema: "REDGPS", codigo: "A003" }` y obtiene `activoId: 42`.
4. El módulo actualiza la posición del activo 42.

**Caso 2 — Se da de alta un activo nuevo en Activos:**
1. Admin crea el activo desde la UI de Activos. Se autogenera `codigoInterno = "AB-EQ-A125"`.
2. Si el activo tiene GPS, el admin elige de un dropdown de "vehículos RedGPS sin vincular" cuál corresponde (carga automática de `codigoExterno`, `idExterno`, `empresaExterna`, `metadata`).
3. Si el activo tiene Cintelink, vincula con un segundo dropdown análogo.
4. Se crean N filas en `equipos_vinculaciones_externas`.

**Caso 3 — Llega una carga de combustible Cintelink:**
1. Cintelink push al Gateway: `{ codigoCintelink: "XYZ123", patente, litros, ... }`.
2. El backend de Activos (o el Gateway que reenvía) resuelve `POST /api/vinculaciones/resolver { sistema: "CINTELINK", codigo: "XYZ123" }` → obtiene `activoId`.
3. Se inserta en `CargaCombustible` con `activoId` (se puede agregar este campo nuevo a la tabla para que el vínculo sea firme y no solo por string).

### Pasos de implementación

1. **Agregar el modelo Prisma** y correr `npx prisma migrate dev --name add-vinculaciones-externas` en local.
2. **Implementar los endpoints** del módulo `vinculaciones` en el backend de Activos.
3. **Pantalla de gestión** en el frontend: lista de activos con sus vínculos, botones para vincular/desvincular.
4. **Pantalla de pendientes:** muestra lado a lado "activos sin vincular" y "vehículos externos sin activo", con match sugerido por nombre/patente.
5. **Script de backfill** (ver arriba).
6. **Integrar el resolver** en los módulos que consumen eventos externos (partes diarios, cargas de combustible, alertas GPS).
7. **Deprecar `gpsId`:** una vez poblada la tabla, `Activo.gpsId` se vuelve redundante. Mantenerlo durante una ventana de compatibilidad y luego eliminarlo.

### Checklist M3

- [ ] Modelo `VinculacionExterna` en schema.prisma.
- [ ] Migración Prisma aplicada en local.
- [ ] Endpoints implementados y probados con Postman/curl.
- [ ] Pantalla de gestión en el frontend.
- [ ] Script de backfill probado en local con dump reciente.
- [ ] Script de backfill corrido en prod (`--dry-run` primero, revisión, `--apply`).
- [ ] Reporte post-backfill: X activos vinculados, Y pendientes documentados.
- [ ] Gateway actualizado con cache de mapping (opcional).
- [ ] Módulos consumidores adaptados para usar el resolver.
- [ ] Campo `gpsId` marcado como deprecated en schema + eliminar en una migración posterior.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| M1 falla a mitad y deja Activos sin BD | Backup pre-migración + script de rollback testeado |
| Diferencia entre hashes bcrypt de los dos módulos | bcrypt es portable; se verifica con un login de prueba antes de cortar acceso legacy |
| Usuarios duplicados por mismo email en distintos módulos | El script de migración detecta y fusiona; genera log de conflictos para revisión manual |
| Hub cae → nadie puede loguear en ningún módulo | Monitoreo de healthcheck del Hub + fallback: durante N semanas mantener endpoints locales deshabilitados pero no borrados |
| Permisos mal configurados → usuario pierde acceso | Auditoría de cambios en `hub_audit_log` + procedimiento de escalación a admin global |
| M3 — activo con código legacy ambiguo (dos activos mismo `A003` en empresas distintas) | La unicidad es `(sistemaExterno, codigoExterno)` global; si hay conflicto, el script de backfill lo reporta y requiere resolución manual. Se puede agregar `empresaExterna` al unique si se confirma que conviven. |
| M3 — vehículo RedGPS cambia de código en origen | El mapping queda obsoleto silenciosamente. Mitigación: job diario que compara la lista del Gateway contra vinculaciones activas y alerta ante códigos perdidos. |
| M3 — script de backfill matchea mal por homónimo | Corrida obligatoria en `--dry-run` primero; revisión humana del reporte antes de `--apply`. |

---

## Próximos pasos inmediatos

1. **Revisar este plan con Alejandro** antes de ejecutar cualquier cosa.
2. **Decidir ventana** para M1 (ideal: fuera de horario operativo, sábado por la mañana).
3. **Arrancar M3 en paralelo con la planificación de M1** — es de bajo riesgo y se puede implementar en local + backfill `--dry-run` sin afectar prod.
4. **Decidir si se encara M2 entero o por partes** (se puede migrar primero el Hub como backend de auth manteniendo las UIs de login locales como fallback).
