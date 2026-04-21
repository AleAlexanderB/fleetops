# CONSIDERACIONES DE SISTEMA — Requisitos no funcionales y reglas transversales

> **Propósito:** Definir los requisitos que todos los sistemas del ecosistema deben respetar, independientemente de su dominio específico. Este es el "contrato técnico" compartido.
> **Audiencia:** Todo el equipo (expertos de proceso para entender qué es obligatorio, devs para implementar).
> **Fuente de verdad:** Versionado en `ab-dev-standards/CONSIDERACIONES.md`.
> **Última actualización:** Abril 2026

---

## 1. Multi-tenant (múltiples empresas del grupo)

El grupo tiene 14+ empresas. Todo sistema debe soportar aislamiento por empresa desde el diseño.

**Modelo elegido:** cada tabla de negocio tiene `empresa_id` (o `empresa`). Las consultas siempre filtran por empresa. Los usuarios pueden tener acceso a una o varias empresas, definido en el Hub.

**Regla:** ninguna consulta puede omitir el filtro de empresa en el backend. Esto se aplica a nivel de middleware, no de código del endpoint.

**Permisos a múltiples empresas:** un usuario puede tener acceso a varias empresas (ej: Alejandro = admin en todas). El JWT del Hub incluye la lista `empresas: [id1, id2, ...]` y los módulos filtran por esa lista.

**Roles estándar (definidos en el Hub, por módulo):**
- `admin` (super-admin global del grupo): acceso total a todos los módulos.
- `admin_modulo`: admin dentro de un módulo específico (ej: `admin_activos`).
- `operador`: operativo limitado.
- `consulta`: solo lectura.
- Roles adicionales específicos por módulo (ej: Activos tiene `PATRIMONIO`, `LEGAL`; FleetOPS tiene `fleet_manager`).

**Excepción:** equipos pueden prestarse entre empresas del grupo. Esto se modela con una tabla de préstamos y no rompe el aislamiento.

---

## 2. Timezone y manejo de fechas

- **Timezone fijo:** `America/Argentina/Jujuy` (UTC-3, sin daylight saving). Equivalente a `America/Argentina/Buenos_Aires` para efectos prácticos.
- **Helpers obligatorios en cada sistema:** `hoyArgentina()` y `fechaArgentina()`.
  - Implementación correcta: `new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })` → devuelve `YYYY-MM-DD` en hora local.
  - **Nunca usar:** `new Date().toISOString().split('T')[0]` — devuelve fecha UTC, no fecha local.
- **Cron jobs diarios:** corren a las **03:00 UTC = 00:00 hora Jujuy** (reset de contadores diarios).
- **Fechas en BD:** siempre UTC (columnas `DATETIME`).
- **Fechas en API:** ISO 8601 con timezone explícito (ej: `2026-04-20T15:30:00-03:00`).
- **Fechas en UI:** siempre formato local Argentina (`DD/MM/YYYY HH:mm`).

---

## 3. Soft deletes

- Todas las tablas de negocio tienen columna `deleted_at DATETIME NULL` (SQL raw) o `deletedAt DateTime?` (Prisma).
- Los borrados son lógicos: `UPDATE tabla SET deleted_at = NOW() WHERE id = ?`.
- Las consultas por defecto excluyen registros con `deleted_at IS NOT NULL`.
- Excepciones (borrado físico permitido): tablas de logs, sesiones expiradas, caches temporales, tablas de posiciones GPS históricas.

---

## 4. Auditoría

Todas las tablas de negocio incluyen marcas temporales. Dos convenciones válidas según stack del módulo:

**FleetOPS (SQL raw):**
```sql
created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

**Activos / módulos nuevos (Prisma):**
```prisma
creadoEn      DateTime  @default(now())
actualizadoEn DateTime  @updatedAt
```

Acciones sensibles (bloqueo de activos, transferencia entre empresas, cambios de rol, creación/desactivación de usuarios) se registran en la tabla `hub_audit_log` del Hub con: usuario, acción, módulo, entidad, entidad_id, payload antes/después, timestamp.

---

## 5. Autenticación y autorización

**Modelo objetivo (migración en curso):**
- Los usuarios viven **solo en el Hub** (BD `hub`, tabla `hub_usuarios`).
- El Hub emite el JWT con payload `{ userId, email, empresas, permisos }`.
- Cada módulo valida el JWT usando el `JWT_SECRET` compartido y **no consulta ninguna tabla de usuarios propia**.
- Para obtener datos frescos del usuario, un módulo llama `GET /api/usuarios/:id` al Hub.
- Para verificar permisos finos, un módulo llama `GET /api/permisos/:userId/:modulo` al Hub.

**Estado actual (legacy, a deprecar):**
- FleetOPS tiene tabla `fleetops_usuarios` propia (username + password).
- Activos tiene tabla `equipos_usuarios` propia (email + password).
- El Hub genera JWT pero cada módulo también puede autenticar localmente.
- La coexistencia es el costo de la migración: durante la transición, ambos caminos funcionan hasta que todos los usuarios estén en el Hub.

**Módulo de Configuración General** (vive en el Hub):
- CRUD de usuarios del grupo.
- CRUD de empresas.
- Matriz de permisos usuario × módulo (ej: Juan = `admin_activos` + `consulta_fleetops`).
- Auditoría de cambios de permisos.

**Configuración:**
- Expiración de tokens: 24 horas (`expiresIn: '24h'`).
- Refresh tokens: no implementados aún.
- Contraseñas: hash con `bcrypt`, cost factor mínimo 10.
- Permisos: modelo RBAC. Roles asociados a (usuario, módulo), no permisos granulares individuales.

---

## 6. Manejo de archivos adjuntos

- **Almacenamiento:** disco local del servidor VPS, volumen Docker por módulo (`/app/uploads/` dentro del contenedor, mapeado a volumen nombrado). Incluidos en el backup diario.
- **Tipos permitidos:** documentos (PDF, JPG, PNG), máximo **10 MB** por archivo.
- **Nomenclatura:** `{entidad}/{entidad_id}/{uuid}-{nombre_original}`.
- **Seguridad:** archivos no públicos; se sirven vía endpoint autenticado que verifica permisos del usuario contra el Hub.
- **Backup:** volumen incluido en el backup diario (`mysqldump` para BD + `tar` para volúmenes).

> **Nota:** si el volumen de archivos crece significativamente, evaluar migración a S3-compatible (DigitalOcean Spaces o similar) sin cambiar la API de los módulos.

---

## 7. Performance y escalabilidad

- **Usuarios concurrentes esperados:** ~20 usuarios simultáneos por módulo (contexto: grupo de 14+ empresas, uso interno).
- **Volumen de datos estimado a 3 años:** FleetOPS ~50.000 viajes/año; Activos ~500 equipos, ~10.000 registros de mantenimiento/año, ~50.000 cargas de combustible/año.
- **Índices obligatorios:** todas las FKs, columnas usadas en `WHERE` frecuentes, columnas usadas en `ORDER BY`.
- **Queries N+1 prohibidas:** usar `JOIN` explícitos (SQL raw) o `include` (Prisma) correctamente.
- **Paginación obligatoria:** endpoints que devuelven listas nunca retornan todo; siempre con `?page` y `?limit` (default 50, máximo 200).
- **Cache:** respuestas de catálogos que cambian poco (geocercas, lista de empresas, permisos de usuario) se cachean en memoria con TTL de 5 minutos.

---

## 8. Backups y recuperación

- **Frecuencia:** backup completo diario de **todas las BDs** (`fleetops`, `activos`, `hub`, ...), a las **03:00 hora Jujuy (06:00 UTC)**.
- **Script:** `/opt/fleetops/backup_db.sh` — usa `mysqldump --all-databases --single-transaction`. O backups por BD separados si se desea restaurar un módulo individual.
- **Retención:** 14 días de backups diarios en `/opt/fleetops/backups/`.
- **Ubicación actual:** mismo servidor VPS. ⚠️ Pendiente mover a ubicación externa (DigitalOcean Spaces o similar) para proteger ante falla del servidor.
- **Verificación:** test de restauración al menos una vez antes de un cambio de migración grande.
- **Antes de operaciones destructivas:** backup manual obligatorio de la BD afectada. Comando:
  ```bash
  docker exec fleetops_db mysqldump -u root -p<ROOT_PASS> --single-transaction <nombre_bd> > backup_manual_$(date +%Y%m%d_%H%M%S).sql
  ```
- **Recuperación de punto en el tiempo:** MySQL binlog habilitado (`log_bin=ON`) permite recuperar hasta posición exacta. El binlog es compartido por la instancia pero los eventos están etiquetados por BD, así que se puede filtrar.

---

## 9. Logs y observabilidad

- **Logs:** `console.log` / `console.error` de Node.js, capturados por Docker (`docker logs <contenedor>`).
- **Nunca loguear:** contraseñas, tokens JWT, datos de tarjetas, información personal sensible.
- **Retención de logs:** 7 días (rotación de Docker por defecto; configurar `max-size` y `max-file` en compose si es necesario).
- **Monitoreo básico:** `docker ps` para verificar que los contenedores están up. No hay sistema de alertas automáticas aún.
- **Logs estructurados (objetivo futuro):** migrar a JSON logs + Loki o similar cuando el equipo crezca.

---

## 10. Versionado de APIs

- Todas las rutas expuestas a otros sistemas van bajo `/api/v1/`, `/api/v2/`, etc.
- Cambios breaking requieren nueva versión; la anterior se mantiene con deprecation notice durante mínimo **3 meses**.
- Cada sistema publica su `openapi.yaml` en su repo y en `ab-contratos-api`.
- Cambios de contrato requieren pull request al repo `ab-contratos-api` con review del sistema consumidor.

---

## 11. Secretos y credenciales

- **Nunca commitear:** `.env`, claves privadas, tokens de API, `server_key`.
- **Commitear siempre:** `.env.example` con todas las variables necesarias y valores placeholder.
- **Gestión actual:** archivo `SECRETOS.md` en la raíz del repo (en `.gitignore`). Se comparte por canal seguro (mensaje directo, no email ni chat grupal).
- **Contenido de `SECRETOS.md`:** passwords MySQL de cada BD, JWT_SECRET, API keys de servicios externos (RedGPS, Cintelink, Pajet), clave SSH del VPS.
- **Rotación:** revisar y rotar claves de servicios externos **una vez al año** o ante sospecha de compromiso.

---

## 12. Integración con servicios externos

**Regla general:** ningún módulo llama a una API externa directamente. Todas las integraciones externas pasan por el **Integration Gateway**.

| Servicio | Uso | Consumidor actual | Límites conocidos | Fallback si falla |
|----------|-----|------------------|-------------------|-------------------|
| RedGPS API | Tracking de flota, geocercas, alertas | FleetOPS, Activos | Token expira en 6h (renovación automática), polling mínimo 30s, `getAlerts` retorna 30300 | Gateway usa última ubicación conocida; alertas vía webhook push siguen funcionando |
| RedGPS Webhook | Alertas push (combustible, velocidad, etc.) | FleetOPS | Requiere URL pública configurada en plataforma RedGPS | Revisar logs del webhook en `/api/webhook/redgps` |
| Cintelink API | Combustible: estaciones, tanques, transacciones | Activos | (documentar límites de rate según proveedor) | Gateway cachea último snapshot; datos de hasta N horas atrás |
| Pajet API | TBD (futuro) | TBD | — | — |

> **Nota sobre el webhook:** el endpoint `/api/webhook/redgps` debe estar **antes** del middleware de autenticación en el router (no requiere JWT — las llamadas vienen de RedGPS, no de usuarios). Esto fue un bug real corregido en abril 2026.

---

## 13. Idioma y localización

- **Idioma de campos en BD:** **español** (decisión tomada de facto en FleetOPS y Activos: `patente`, `empresa`, `nombre`, `viajes_libres`, `geocercas`, `creadoEn`, etc.). Respetar en todos los módulos nuevos.
- **Mensajes al usuario final:** español (Argentina).
- **Mensajes de error técnicos en logs:** español o inglés (indistinto para el equipo actual).
- **Moneda por defecto:** ARS (pesos argentinos).
- **Formato de números:** separador de miles `.`, decimal `,`.
- **Formato de fechas en UI:** `DD/MM/YYYY HH:mm`.

---

## 14. Política de migraciones de base de datos

- **Cada módulo opera solo contra su propia BD.** Las migraciones de un módulo nunca tocan la BD de otro.
- Las migraciones se escriben como scripts SQL idempotentes (ej: `CREATE TABLE IF NOT EXISTS`) o como migraciones versionadas (Prisma `prisma migrate deploy`).
- Cada módulo corre sus migraciones al iniciar (auto-migrate en `database/migrate.js` o `prisma migrate deploy` al arrancar el contenedor).
- **Nunca correr** `DROP TABLE`, `TRUNCATE`, o `DROP DATABASE` en producción sin backup manual previo.
- Antes de correr una migración grande en producción: backup + review de Alejandro.
- Las migraciones incluyen script de rollback cuando es posible.
- **Migración entre BDs** (ej: mover tablas `equipos_*` de `fleetops` a `activos`): se ejecuta como procedimiento one-off documentado en el repo `ab-arquitectura/migraciones/`, con script de rollback probado en staging antes de correrlo en prod.

---

## 15. Testing mínimo exigido antes de producción

- Tests manuales de los flujos críticos documentados en smoke test checklist del módulo.
- Tests de los endpoints de API que otros sistemas consumen (al menos verificar respuesta 200 y estructura del response).
- Smoke test manual ejecutado y registrado antes de cada deploy a producción.

---

## 16. Checklist antes de considerar un módulo "en producción"

- [ ] Base de datos propia creada (`CREATE DATABASE <modulo>`) con usuario MySQL dedicado y `GRANT ALL` solo sobre esa BD.
- [ ] Filtro de empresa en middleware (multi-tenant).
- [ ] JWT auth validando contra Hub (o legacy local si todavía en transición, con plan de migración documentado).
- [ ] Cuando el Hub esté listo: módulo NO mantiene tabla de usuarios propia.
- [ ] Variables de entorno en `.env.example` actualizadas.
- [ ] Backup automático verificado (la BD del módulo aparece en el script de backup).
- [ ] Webhook/endpoints públicos (sin auth) están **antes** del middleware de auth en el router.
- [ ] Al menos un smoke test manual exitoso con datos reales.
- [ ] OpenAPI spec publicada en `ab-contratos-api` (o al menos documentado en README).
- [ ] Documentación de deploy escrita en el README del repo.
- [ ] Card del módulo activa en el Hub (`landing/html/index.html`).
- [ ] Nginx del Hub configurado para redirigir al puerto del módulo.
- [ ] Integraciones externas pasan por Integration Gateway (no llamadas directas).
