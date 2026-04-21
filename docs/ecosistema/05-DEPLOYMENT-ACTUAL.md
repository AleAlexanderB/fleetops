# ESTADO ACTUAL DEL DEPLOYMENT — Ecosistema AB Construcciones

> **Propósito:** Documentar exactamente cómo está desplegado el sistema hoy. "Si mañana llega un dev nuevo o yo olvido algo, con este archivo puede entender todo."
> **Última actualización:** Abril 2026
> **Responsable:** Alejandro

---

## Servidor de producción

| Dato | Valor |
|------|-------|
| Proveedor | DigitalOcean |
| IP pública | `157.245.219.73` |
| Sistema operativo | Ubuntu 24.04 LTS |
| Usuario SSH | `root` |
| Clave SSH | `server_key` (en raíz del repo local, gitignoreado) |
| Docker versión | 29.4.0 |
| Directorio principal | `/opt/fleetops/` (contiene todo el ecosistema, no solo FleetOPS) |

**Conectarse al VPS:**
```bash
# Primero copiar la clave (se pierde al reiniciar la PC):
cp "E:/VIAJES OyD/fleetops-v8-work/fleetops-v2/server_key" /tmp/server_key && chmod 600 /tmp/server_key

# Luego conectarse:
ssh -i /tmp/server_key -o StrictHostKeyChecking=no root@157.245.219.73
```

---

## Contenedores en ejecución

```
docker ps  →  debería mostrar estos 5 contenedores:
```

| Contenedor | Imagen | Puerto externo | Puerto interno | Estado |
|------------|--------|---------------|----------------|--------|
| `fleetops_hub` | `nginx:alpine` | `80` | `80` | ✅ Corriendo |
| `fleetops_app` | `fleetops:latest` | `8077` | `8077` | ✅ Corriendo |
| `fleetops_gps_gateway` | `gps-gateway:latest` | `3100` *(interno)* | `3100` | ✅ Corriendo (es el **Integration Gateway**; conserva el nombre histórico) |
| `equipos_app` | `equipos:latest` | `8078` | `8078` | ✅ Corriendo (es el sistema **Activos**) |
| `fleetops_db` | `mysql:8.0` | `3306` *(solo interno Docker)* | `3306` | ✅ Corriendo |

**Red Docker interna:** `fleetops_network`. Los contenedores se comunican por nombre: `http://fleetops_app:8077`, `http://fleetops_gps_gateway:3100`, `fleetops_db:3306`.

> **Notas de naming:** por historia, `fleetops_gps_gateway` y `equipos_app` conservan sus nombres de contenedor anteriores (Integration Gateway y Activos respectivamente). Renombrar requiere coordinar con el `.env` y el compose; se puede diferir.

---

## URLs de acceso

| Sistema | URL externa | Notas |
|---------|-------------|-------|
| Hub (login) | `http://157.245.219.73` | Puerta de entrada. Login único para todos los módulos. |
| FleetOPS | `http://157.245.219.73:8077` | O vía hub → redirect con `hub_token` |
| FleetOPS (vía hub) | `http://157.245.219.73/fleetops/` | Nginx hace redirect al puerto 8077 |
| Activos | `http://157.245.219.73:8078/dashboard` | Sistema de activos (equipos + inmuebles + herramientas) |
| Activos (vía hub) | `http://157.245.219.73/activos/` | Redirect vía Nginx al puerto 8078 (pendiente de activar) |
| Integration Gateway | interno solamente | No expuesto públicamente; accesible por los contenedores en la red Docker |
| Webhook RedGPS | `http://157.245.219.73:8077/api/webhook/redgps` | URL configurada en plataforma RedGPS para push de alertas |

---

## Usuarios y accesos

> **Nota importante:** el modelo objetivo es usuarios centralizados en el Hub. Hoy cada módulo aún gestiona usuarios locales; la migración está pendiente.

### FleetOPS — usuarios del sistema (legacy, tabla `fleetops_usuarios`)

| Usuario | Contraseña | Rol | Empresa | Notas |
|---------|-----------|-----|---------|-------|
| `admin` | `admin123` | admin | (todas) | ⚠️ Cambiar contraseña en producción |
| `corralon` | `Corralon2026` | empresa | Corralón El Mercado | Creado abril 2026 |
| `viap` | `Viap2026` | empresa | VIAP | Creado abril 2026 |

### Activos — usuarios del sistema (legacy, tabla `equipos_usuarios`)

| Email | Contraseña | Rol |
|-------|-----------|-----|
| `admin@ab.com` | `demo1234` | SUPERADMIN |
| `activos@ab.com` | `demo1234` | ADMIN_ACTIVOS |
| `patrim@ab.com` | `demo1234` | PATRIMONIO |
| `legal@ab.com` | `demo1234` | LEGAL |
| `operador@ab.com` | `demo1234` | OPERADOR |

> ⚠️ Passwords demo. Rotar antes de uso real.

> Las contraseñas reales y todos los otros secretos están en `SECRETOS.md` (no está en el repo).

### Cuentas de servicios externos (gestionadas por el Integration Gateway)

| Servicio | Cuenta | Uso |
|----------|--------|-----|
| RedGPS (Corralón) | `apaza866@gmail.com` | Tokens gestionados por el gateway |
| RedGPS (VIAP) | `uviap@gmail.com` | Tokens gestionados por el gateway |
| Cintelink | (ver `SECRETOS.md`) | Tokens gestionados por el gateway |
| Pajet | *(pendiente)* | Integración no iniciada |

---

## Base de datos MySQL

| Dato | Valor |
|------|-------|
| Contenedor | `fleetops_db` |
| Imagen | `mysql:8.0` |
| Instancia única | sí (un solo contenedor MySQL para todo el ecosistema) |
| Puerto | `3306` (solo interno Docker) |
| Binlog | Habilitado (`log_bin=ON`) — permite recuperación punto en el tiempo |

**Bases de datos dentro de la instancia:**

| BD | Módulo dueño | Usuario MySQL | Estado |
|----|-------------|---------------|--------|
| `fleetops` | FleetOPS + (temporalmente) Activos | `fleetops`, `equipos_user` | ⚠️ Activos todavía vive dentro de `fleetops` con prefijo `equipos_*`. **Migración pendiente** a BD `activos`. |
| `activos` | Activos | `activos_user` | ⏳ Pendiente de crear |
| `hub` | Hub (usuarios, empresas, permisos) | `hub_user` | ⏳ Pendiente de crear |
| `erp` | ERP (futuro) | `erp_user` | ⏳ Futuro |

**Conectar a MySQL:**
```bash
# Desde el VPS, a una BD específica:
docker exec -it fleetops_db mysql -u fleetops -p<PASSWORD> fleetops
docker exec -it fleetops_db mysql -u equipos_user -p<PASSWORD> fleetops

# Con root (solo para admin):
docker exec -it fleetops_db mysql -u root -p<ROOT_PASSWORD>
```

**Tablas por módulo (estado actual):**

| Módulo | BD actual | Prefijo de tabla | Ejemplos |
|--------|-----------|------------------|----------|
| FleetOPS | `fleetops` | `fleetops_*` | `fleetops_viajes_libres`, `fleetops_viajes_programados`, `fleetops_divisiones`, `fleetops_vehiculos`, `fleetops_usuarios`, `fleetops_tarifas` |
| Activos | `fleetops` *(a migrar)* | `equipos_*` | `equipos_activos`, `equipos_usuarios`, `equipos_mantenimiento`, `equipos_contratos`, `equipos_combustible_cargas`, `equipos_documentos` |

> **Plan de migración (pendiente):** crear BD `activos`, mover tablas `equipos_*` ahí, renombrar quitando el prefijo redundante (o mantener por compatibilidad), actualizar `DATABASE_URL` de Activos a `mysql://activos_user:***@fleetops_db:3306/activos`, revocar GRANT sobre `fleetops.equipos_%`.

---

## Backup automático

- **Script:** `/opt/fleetops/backup_db.sh`
- **Frecuencia:** diario a las **06:00 UTC (03:00 hora Jujuy)** vía cron
- **Retención:** últimos 14 días
- **Alcance:** todas las BDs de la instancia (`--all-databases` o backup individual por BD).
- **Destino:** `/opt/fleetops/backups/<bd>_YYYYMMDD.sql.gz`
- **Log:** `/var/log/fleetops_backup.log`

**Verificar último backup:**
```bash
ssh -i /tmp/server_key root@157.245.219.73 'ls -lh /opt/fleetops/backups/ | tail -10'
```

**Hacer backup manual de una BD específica:**
```bash
ssh -i /tmp/server_key root@157.245.219.73 \
  'docker exec fleetops_db mysqldump -u root -p<ROOT_PASS> --single-transaction --routines --triggers <nombre_bd> | gzip > /opt/fleetops/backups/<nombre_bd>_manual_$(date +%Y%m%d_%H%M%S).sql.gz'
```

---

## Estructura de archivos en el VPS

```
/opt/fleetops/
├── docker-compose.yml         ← orquestación de todos los servicios del ecosistema
├── .env                       ← variables de entorno compartidas (passwords, secrets)
├── backups/                   ← backups diarios de MySQL (todas las BDs)
├── landing/
│   ├── html/index.html        ← Hub: página de login + cards de módulos
│   └── nginx.conf             ← config nginx del Hub
├── server/                    ← código backend FleetOPS
├── client/                    ← código frontend FleetOPS (build producción)
├── gps-gateway/               ← código del Integration Gateway
└── equipos/                   ← código de Activos (clonado de ab-equipos)
    ├── server/
    ├── client/
    └── Dockerfile
```

---

## Cómo hacer deploy de cambios

### Deploy de FleetOPS (backend o frontend)
```bash
# 1. Subir los archivos modificados (desde máquina local con repo):
scp -i /tmp/server_key -r ./server/src root@157.245.219.73:/opt/fleetops/server/
scp -i /tmp/server_key -r ./client/src root@157.245.219.73:/opt/fleetops/client/

# 2. Rebuild y restart:
ssh -i /tmp/server_key root@157.245.219.73 \
  'cd /opt/fleetops && docker compose build app && docker compose up -d app'

# 3. Verificar logs:
ssh -i /tmp/server_key root@157.245.219.73 'docker logs fleetops_app --tail 30'
```

### Deploy del Integration Gateway
```bash
ssh -i /tmp/server_key root@157.245.219.73 \
  'cd /opt/fleetops && docker compose build gps-gateway && docker compose up -d gps-gateway'
```

### Deploy de Activos
```bash
# 1. Pull del repo en el VPS:
ssh -i /tmp/server_key root@157.245.219.73 'cd /opt/fleetops/equipos && git pull'

# 2. Rebuild y restart:
ssh -i /tmp/server_key root@157.245.219.73 \
  'cd /opt/fleetops && docker compose build equipos && docker compose up -d equipos'
```

### Restart rápido sin rebuild (cuando solo cambia .env o config):
```bash
ssh -i /tmp/server_key root@157.245.219.73 \
  'cd /opt/fleetops && docker compose restart <servicio>'
```

### Ver logs en tiempo real:
```bash
ssh -i /tmp/server_key root@157.245.219.73 'docker logs fleetops_app -f'
ssh -i /tmp/server_key root@157.245.219.73 'docker logs fleetops_gps_gateway -f'
ssh -i /tmp/server_key root@157.245.219.73 'docker logs equipos_app -f'
```

---

## Estado de los módulos (Abril 2026)

### ✅ FleetOPS v9 — En producción

**Funcionalidades activas:**
- Dashboard GPS con posiciones en tiempo real (SSE)
- Viajes libres: apertura/cierre automático por geocercas
- Viajes programados: planificación vs. ejecución real
- Alertas GPS: velocidad, combustible, geocercas (via webhook RedGPS)
- Geocercas: detección polígonos, círculos, líneas con buffer
- Informes: filtros por fecha, empresa, unidad de negocio
- Multi-empresa: VIAP y Corralón El Mercado con aislamiento por empresa
- Hub SSO: login único, token pasado por URL param al módulo

**Limitaciones conocidas:**
- `/getAlerts` de la API RedGPS retorna error 30300 — no está habilitado para estas cuentas. Las alertas llegan solo vía webhook push.
- Contraseña de admin es `admin123` — pendiente cambiar.
- Sin dominio propio — solo IP.
- Backups solo en el mismo servidor (sin copia externa).
- Usuarios todavía en tabla local `fleetops_usuarios` (migración al Hub pendiente).

### ✅ Activos (repo `ab-equipos`) — En producción

**Stack:** React + Vite + **Express + Prisma** + MySQL 8.4 + Docker.

**Alcance del módulo:** equipos + inmuebles + herramientas, en un solo dashboard con tabs.

**Funcionalidades activas:**
- Dashboard con KPIs por categoría (Equipos / Inmuebles / Herramientas).
- CRUD de activos con odómetro/horómetro, GPS (vía Integration Gateway), documentos adjuntos.
- Bloqueo automático por vencimiento documental.
- Inmuebles: ocupación, contratos, valuaciones, semáforo documental.
- Herramientas: inventario, asignación, ubicación.
- Parte diario: registro km/hs, comparación contra GPS.
- Personal (choferes desde sistema externo).
- Alertas: docs vencidos, contratos vencidos, por vencer.
- Configuración: tipos, subtipos, marcas, modelos, empresas.
- Cargas de combustible vía Cintelink (a través del Integration Gateway).
- Cron automático cada 6hs: bloqueo por docs vencidos, alertas, contratos.

**Módulos del backend (15):** activos, alertas, auth, combustible, config, contratos, dashboard, documentos, gps, historial, ocupaciones, partes, personal, reportes, valuaciones.

**Limitaciones conocidas:**
- Usuarios en tabla local `equipos_usuarios` (migración al Hub pendiente).
- Tablas viven dentro de la BD `fleetops` con prefijo `equipos_*` — migración a BD propia `activos` pendiente.
- Passwords de usuarios demo (`demo1234`) — rotar antes de uso real intensivo.

### ✅ Integration Gateway — En producción

**Estado:** corriendo y estable.
**Servicios integrados:**
- **RedGPS**: polling de posiciones cada 30s + webhook push de alertas. Tokens renovados cada 6h automáticamente.
- **Cintelink**: datos de combustible (estaciones, tanques, transacciones). Consumido por Activos.
**Pendiente:**
- Integración con **Pajet** (futura).

**Consumidores internos:**
- FleetOPS: SSE de posiciones y geocercas.
- Activos: SSE de posiciones + endpoints `/api/cintelink/*`.

### ⏳ Hub + Configuración General — Pendiente de ampliar

**Hoy:** el Hub sirve solo para login (página estática) y redirect a los módulos con `hub_token`.
**Objetivo:** ampliar para que sea el dueño único de usuarios, empresas y permisos por módulo, con un CRUD administrativo (módulo "Configuración General").

### ⏳ ERP — Futuro

Sin cronograma. Queda fuera de auth (eso es del Hub).

---

## Tareas pendientes de infraestructura

| Tarea | Prioridad | Notas |
|-------|-----------|-------|
| Migrar Activos a BD propia (`activos`) | 🔴 Alta | Separar de `fleetops` para aislamiento real |
| Crear BD `hub` + tabla `hub_usuarios` | 🔴 Alta | Base de la centralización de usuarios |
| Migrar usuarios de FleetOPS y Activos al Hub | 🔴 Alta | Requiere módulo de Configuración General |
| Cambiar contraseña `admin123` | 🔴 Alta | Riesgo de seguridad en producción |
| Integrar Pajet al Integration Gateway | 🟡 Media | Pendiente acceso a la API |
| Configurar dominio propio | 🟡 Media | DNS + certificado SSL |
| Backup externo (fuera del VPS) | 🟡 Media | DigitalOcean Spaces o similar |
| Certificado SSL / HTTPS | 🟡 Media | Requiere dominio propio primero |
| Staging environment | 🟢 Baja | Para módulos futuros |
| Rotar secretos de servicios externos | 🟢 Baja | Revisión anual |
