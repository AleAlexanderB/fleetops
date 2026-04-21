# CLAUDE.md Maestro — Ecosistema AB Construcciones

> Este archivo es el punto de partida para cualquier conversación con Claude sobre el ecosistema de sistemas de AB Construcciones SRL.
> **Cómo usar:** al inicio de una conversación nueva, pegá este archivo completo como primer mensaje o adjuntalo al knowledge base del Project.

---

## Quién soy y qué estamos construyendo

Soy Alejandro, Ingeniero Civil, gerente de hormigón, agregados, planta de premoldeados y obras en AB Construcciones SRL (Jujuy, Argentina). Estoy construyendo los sistemas internos del grupo (14+ empresas, incluyendo Corralón El Mercado y VIAP).

Trabajo en un equipo mixto: soy el experto de proceso y también el dev principal. Claude Code es mi herramienta central de desarrollo.

---

## Sistemas del ecosistema

| Sistema | Estado | URL | Puerto |
|---------|--------|-----|--------|
| **Hub** (login central + Configuración General) | ✅ Producción (login), ⏳ Config General | `http://157.245.219.73` | 80 |
| **FleetOPS** (flota GPS + viajes) | ✅ Producción | `http://157.245.219.73:8077` | 8077 |
| **Integration Gateway** (RedGPS + Cintelink + Pajet futuro) | ✅ Producción | interno Docker | 3100 |
| **Activos** (equipos + inmuebles + herramientas) | ✅ Producción | `http://157.245.219.73:8078` | 8078 |
| **ERP** (futuro) | ⏳ Futuro | — | — |

**Notas de naming importantes:**
- No existe un "Sistema Viajes" separado. Los viajes son parte de FleetOPS.
- El sistema que gestiona equipos + inmuebles + herramientas se llama **"Activos"**. El repo se llama `ab-equipos` por razones históricas.
- El microservicio de integraciones se llama **"Integration Gateway"** (ya no "GPS Gateway", que era el nombre cuando solo integraba RedGPS). Servicios cubiertos hoy: RedGPS y Cintelink. Pajet pendiente.

---

## Stack técnico

- **Frontend:** React 18 + Vite + Tailwind CSS
- **Backend:** Node.js + Express
- **ORM:** **Prisma válido para módulos nuevos** (Activos ya lo usa). FleetOPS mantiene SQL raw con `mysql2` por historia del código.
- **BD:** MySQL 8.4, **una instancia con múltiples bases de datos** (una por módulo). Instancia única `fleetops_db`. BDs: `fleetops`, `activos` (pendiente migrar), `hub` (pendiente crear).
- **Contenedorización:** Docker + Docker Compose
- **Hub:** Nginx
- **Auth:** Usuarios centralizados en el Hub. JWT emitido por el Hub, validado por cada módulo con `JWT_SECRET` compartido. SSO via `?hub_token=` en URL.
- **Timezone:** `America/Argentina/Jujuy` (UTC-3, sin DST)
- **Idioma de campos en BD:** español

---

## Servidor VPS

| Dato | Valor |
|------|-------|
| IP | `157.245.219.73` |
| Proveedor | DigitalOcean |
| OS | Ubuntu 24.04 |
| Directorio | `/opt/fleetops/` (contiene todo el ecosistema) |
| Clave SSH | `server_key` en raíz del repo (gitignoreado) |

**Preparar clave SSH al inicio de cada sesión:**
```bash
cp "E:/VIAJES OyD/fleetops-v8-work/fleetops-v2/server_key" /tmp/server_key && chmod 600 /tmp/server_key
```

**Conectar:**
```bash
ssh -i /tmp/server_key -o StrictHostKeyChecking=no root@157.245.219.73
```

---

## Reglas de negocio y convenciones que Claude debe respetar

### Arquitectura
1. **Nunca acceder a la BD de otro módulo.** Cada módulo tiene su propia BD dentro de la misma instancia MySQL. Comunicación entre módulos solo por API HTTP.
2. **Cada módulo = una BD propia** (`fleetops`, `activos`, `hub`, ...) con su propio usuario MySQL (`GRANT ALL ON <bd>.*`).
3. **Ninguna integración externa directa.** RedGPS, Cintelink y Pajet (futuro) siempre pasan por el **Integration Gateway**.
4. **Webhooks / endpoints públicos** (como `/api/webhook/redgps`) deben estar **antes** del middleware de auth en el router Express.
5. **Filtrar siempre por empresa** en el backend (campo `empresa` o `empresa_id` en tablas de negocio). El JWT del Hub incluye la lista de empresas accesibles por el usuario.

### Identidad de activos entre sistemas
6. **Un activo físico tiene un único `codigoInterno`** en Activos (formato `{empresa}-{CAT}-{letraTipo}{seq:03}`, ej: `AB-EQ-A003`).
7. **Los códigos de sistemas externos** (RedGPS `A003`, Cintelink, Pajet futuro) NO se guardan como campos sueltos en la tabla `equipos_activos`. Viven en la tabla `equipos_vinculaciones_externas` con unique `(sistemaExterno, codigoExterno)`.
8. **Para resolver** "este código externo corresponde a qué activo interno", usar `POST /api/vinculaciones/resolver` de Activos. No hacer matching ad-hoc por substring o patente.

### Usuarios y permisos
9. **Los usuarios viven en el Hub, no en cada módulo.** Modelo objetivo: tabla `hub_usuarios` en BD `hub`.
10. **Cada módulo valida el JWT del Hub y consulta datos/permisos a la API del Hub.** No mantiene tabla de usuarios propia.
11. **Transición legacy:** FleetOPS y Activos aún tienen tablas locales (`fleetops_usuarios`, `equipos_usuarios`). Se migran al Hub en esta fase del trabajo.

### Fechas y timezone
12. **Nunca usar** `new Date().toISOString().split('T')[0]` para obtener la fecha de hoy. Usar:
    ```javascript
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    // → '2026-04-20'
    ```
13. **Los cron jobs diarios** corren a las 03:00 UTC (= 00:00 hora Jujuy).

### Código
14. **Sin Prisma en FleetOPS** — usa queries MySQL directas con el paquete `mysql2`. En módulos nuevos (Activos, Hub, etc.) Prisma es válido y preferido.
15. **IDs:** autoincremental (`INT AUTO_INCREMENT`), no UUIDs.
16. **Soft deletes:** columna `deleted_at DATETIME NULL` (SQL raw) o `deletedAt DateTime?` (Prisma) en tablas de negocio.
17. **Auditoría:** `created_at`/`updated_at` (SQL raw) o `creadoEn`/`actualizadoEn` (Prisma). Cada módulo es internamente consistente.
18. **No romper el diseño visual** entre fases de desarrollo. Si algo funciona, no tocar el CSS sin confirmar.

### Flujo de trabajo
19. **Siempre entregar archivos descargables**, no solo contenido en el chat.
20. **No avanzar de fase sin confirmación explícita** del usuario.
21. **Antes de hacer cambios destructivos** (DROP, TRUNCATE, rm -rf): pedir confirmación explícita.

---

## Estructura del repo local

```
E:/VIAJES OyD/fleetops-v8-work/fleetops-v2/
├── docker-compose.yml
├── .env                        ← credenciales (NO en repo)
├── server_key                  ← clave SSH VPS (NO en repo)
├── SECRETOS.md                 ← todas las passwords (NO en repo)
├── PROYECTO_CONTEXTO.md        ← contexto operativo del proyecto
├── docs/ecosistema/            ← estos documentos de arquitectura
│   ├── 00-RESUMEN-CONVERSACION.md
│   ├── 02-ARQUITECTURA.md
│   ├── 03-CONSIDERACIONES.md
│   ├── 04-PROTOCOLO-HANDOFF.md
│   ├── 05-DEPLOYMENT-ACTUAL.md
│   └── CLAUDE.md               ← este archivo
├── landing/
│   ├── html/index.html         ← Hub: login + cards módulos
│   └── nginx.conf
├── gps-gateway/                ← microservicio **Integration Gateway** (nombre de carpeta conserva historia)
│   └── src/
├── server/                     ← backend FleetOPS
│   └── src/
│       ├── router.js
│       └── modules/
└── client/                     ← frontend FleetOPS (React+Vite)
    └── src/

E:/001-EQUIPOS/                 ← repo del sistema **Activos** (repo `ab-equipos`)
├── server/                     ← Express + Prisma, 15 módulos
│   ├── prisma/schema.prisma
│   └── src/modules/
└── client/                     ← React + Vite
```

---

## Comandos frecuentes

```bash
# Ver estado de contenedores
ssh -i /tmp/server_key root@157.245.219.73 'docker ps'

# Ver logs FleetOPS
ssh -i /tmp/server_key root@157.245.219.73 'docker logs fleetops_app --tail 50'

# Ver logs Integration Gateway
ssh -i /tmp/server_key root@157.245.219.73 'docker logs fleetops_gps_gateway --tail 50'

# Ver logs Activos
ssh -i /tmp/server_key root@157.245.219.73 'docker logs equipos_app --tail 50'

# Entrar a MySQL (por BD)
ssh -i /tmp/server_key root@157.245.219.73 'docker exec -it fleetops_db mysql -u fleetops -p<PASS> fleetops'
ssh -i /tmp/server_key root@157.245.219.73 'docker exec -it fleetops_db mysql -u equipos_user -p<PASS> fleetops'

# Rebuild y restart un servicio
ssh -i /tmp/server_key root@157.245.219.73 'cd /opt/fleetops && docker compose build <servicio> && docker compose up -d <servicio>'

# Backup manual de una BD
ssh -i /tmp/server_key root@157.245.219.73 'docker exec fleetops_db mysqldump -u root -p<ROOT_PASS> --single-transaction <bd> | gzip > /opt/fleetops/backups/manual_$(date +%Y%m%d_%H%M).sql.gz'
```

---

## Lo que Claude NO debe hacer sin confirmación explícita

- Cambiar diseño visual (CSS, colores, layouts).
- Hacer `DROP TABLE`, `TRUNCATE`, `DROP DATABASE`, o borrar datos de producción.
- Hacer push o commit al repositorio.
- Modificar el `.env` del servidor.
- Agregar dependencias npm sin mencionarlo.
- Avanzar a la siguiente fase de un feature sin que el usuario confirme la fase anterior.
- Cruzar datos entre BDs (un módulo leyendo BD de otro módulo).
- Integrar directo a APIs externas sin pasar por el Integration Gateway.

---

## Contexto de empresas

| Empresa | Usuarios actuales | Contexto |
|---------|------------------|----------|
| Corralón El Mercado | `corralon` (FleetOPS) | Camiones, hormigoneras, equipos de obra |
| VIAP | `viap` (FleetOPS) | Equipos de construcción, vialidad |
| (Admin / todas) | `admin` (FleetOPS), `admin@ab.com` (Activos) | Acceso completo |

> Los usuarios migrarán al Hub (tabla `hub_usuarios`) con permisos por módulo definidos en la matriz de Configuración General.

---

## Estado conocido de servicios externos

**RedGPS (vía Integration Gateway):**
- Webhook push: `http://157.245.219.73:8077/api/webhook/redgps` — RedGPS envía alertas.
- `/getAlerts` retorna error 30300 — no habilitado para estas cuentas.
- Posiciones: polling del Gateway cada 30 segundos.
- Tokens: renovación automática cada 6 horas en el Gateway.

**Cintelink (vía Integration Gateway):**
- Integración activa, consumida por Activos en `/api/cintelink/{status, tanques, transacciones, estaciones, ...}`.
- Dominio: combustible.

**Pajet:**
- Pendiente. Todavía no se inició la integración.

---

## Para más contexto

Ver archivos en `docs/ecosistema/`:
- `02-ARQUITECTURA.md` — context map completo, bounded contexts, contratos de API.
- `03-CONSIDERACIONES.md` — reglas técnicas transversales, checklist de producción.
- `04-PROTOCOLO-HANDOFF.md` — cómo entregar un prototipo a un dev.
- `05-DEPLOYMENT-ACTUAL.md` — estado exacto del servidor hoy.
- `PROYECTO_CONTEXTO.md` — guía operativa de cómo trabajar con el repo.
