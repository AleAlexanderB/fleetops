# Resumen de decisiones — Ecosistema AB Construcciones

**Fecha de última actualización:** Abril 2026
**Participantes:** Alejandro (Ing. Civil, gerente hormigón/agregados/premoldeados/obras) y Claude
**Objetivo:** Coordinar el desarrollo de múltiples sistemas internos entre expertos de proceso y programadores.

---

## Decisiones firmes tomadas

| # | Decisión | Estado |
|---|----------|--------|
| 1 | **Base de datos separada por módulo** en la misma instancia MySQL — cada módulo tiene su propia BD, con usuario propio. Reemplaza al modelo anterior de BD única con prefijos. | ✅ Firme — migración pendiente en prod |
| 2 | Comunicación entre sistemas solo por API HTTP, nunca por acceso directo a tablas ajenas | ✅ Firme |
| 3 | Un solo Project maestro "Ecosistema AB Construcciones" en Claude.ai | ✅ Firme |
| 4 | Source of truth = GitHub; Projects de Claude = copias de trabajo | ✅ Firme |
| 5 | Estrategia de prototipado por expertos de dominio + handoff estructurado a devs | ✅ Firme |
| 6 | Stack acordado: React+Vite / Node+Express / MySQL 8.4 / Docker. Prisma válido para módulos nuevos; FleetOPS sigue con SQL raw por historia | ✅ Firme |
| 7 | Hub SSO centralizado en puerto 80 — login único para todos los módulos | ✅ Firme — implementado |
| 8 | **Integration Gateway** (ex "GPS Gateway") como microservicio único para servicios externos — RedGPS, Cintelink y Pajet (futuro). Los módulos consumen siempre del gateway, nunca de las APIs externas directamente | ✅ Firme — implementado para RedGPS y Cintelink |
| 9 | Los viajes (libres y programados) son dominio de FleetOPS, no un sistema separado | ✅ Firme |
| 10 | **Usuarios centralizados en el Hub** — los módulos no gestionan usuarios propios. Existirá un módulo de **Configuración General** donde se asignan permisos por usuario y por módulo | ✅ Firme — migración pendiente |
| 11 | Módulo "Activos" cubre Equipos + Inmuebles + Herramientas. El nombre interno del sistema es **Activos** (repo `ab-equipos` por razones históricas) | ✅ Firme — ya implementado |

---

## Temas tratados y conclusiones

### 1. BD separada por módulo — por qué el cambio
**Incidente real:** Un módulo (Equipos) borró tablas del otro (FleetOPS) porque compartían una BD sin aislamiento.
**Intento intermedio:** se adoptó un esquema de BD única con prefijos de tabla + usuarios MySQL con GRANT limitado. Equipos ya corre hoy en producción con ese modelo.
**Decisión final:** aun así, el aislamiento por GRANT es frágil ante errores humanos o de herramientas automáticas (Claude, scripts ad-hoc). Separar las bases de datos elimina el riesgo de raíz.
**Modelo elegido:** una sola instancia MySQL (un contenedor), múltiples bases de datos (`fleetops`, `activos`, `hub`, etc.). Cada módulo con usuario propio y GRANT solo sobre su BD.
**Costo:** mismo consumo de RAM; sí requiere una migración en producción de las tablas `equipos_*` actualmente en `fleetops` hacia la nueva BD `activos`.

### 2. Comunicación entre sistemas solo por API HTTP
Ningún módulo accede directamente a tablas de otro. Si FleetOPS necesita datos de Activos, llama a la API de Activos. Si Activos necesita datos de viajes, llama a la API de FleetOPS.

### 3. Hub SSO — login único
**Problema:** localStorage es origin-specific (puerto 80 ≠ puerto 8077). No se puede compartir token entre el hub y los módulos directamente.
**Solución implementada:** Hub guarda el JWT en su propio localStorage (`ab_hub_session`). Al navegar a un módulo, pasa el token como parámetro URL (`?hub_token=JWT`). El módulo lo lee al cargar, lo guarda en su propio localStorage y limpia la URL.

### 4. Integration Gateway centralizado (ex GPS Gateway)
**Por qué:** múltiples módulos necesitan datos de servicios externos. En lugar de que cada módulo integre cada proveedor (duplicando tokens, requests y manejo de errores), existe un microservicio central que gestiona esas integraciones y distribuye los datos a los módulos internos.
**Servicios externos soportados:**
- **RedGPS** — tracking de flota, geocercas, alertas. Polling + webhook.
- **Cintelink** — datos de combustible (estaciones, tanques, transacciones). Consumido por Activos.
- **Pajet** — futuro. Todavía no se integró.
**Consumidores internos hoy:** FleetOPS (GPS), Activos (GPS + Cintelink).
**Estado:** en producción en el mismo VPS, puerto 3100 (interno Docker).

### 5. Sistema "Activos" — no es "Equipos"
El sistema interno que gestiona maquinaria, inmuebles y herramientas se llama **Activos**. Equipos es solo una de sus categorías. El repo se llama `ab-equipos` por razones históricas pero el producto es Activos.

### 6. Usuarios centralizados en el Hub
**Situación previa:** cada módulo tenía su propia tabla de usuarios (`fleetops_usuarios`, `equipos_usuarios`). Problema: un usuario real del grupo tenía que ser creado en cada módulo, con sus propias contraseñas y roles. Mantenimiento caro, inconsistente y propenso a error.
**Decisión:** los usuarios pasan a vivir **solo en el Hub**. Cada módulo recibe el JWT emitido por el Hub y **no tiene tabla de usuarios propia**. Los datos de usuario (nombre, email) los consulta a la API del Hub si los necesita.
**Módulo de Configuración General:** interfaz (probablemente montada en el Hub) donde un admin crea usuarios, asigna empresas y define permisos por módulo (ej: Alejandro = admin FleetOPS + admin Activos; Juan = operador Activos solamente).
**Migración:** los usuarios actuales de FleetOPS y Activos se migran al Hub, y cada módulo adapta su middleware de auth para validar el JWT del Hub sin consultar tabla local.

### 7. Sistemas del grupo
Los viajes (libres y programados) son parte del dominio de FleetOPS. Activos cubre equipos, inmuebles y herramientas. El ERP (contabilidad, RRHH) queda como sistema futuro — auth ya no depende del ERP, queda en el Hub.

### 8. Estrategia de prototipado por expertos de dominio
Los expertos de proceso (Alejandro) construyen prototipos funcionales con Claude que reflejan la lógica real del negocio. Esos prototipos son especificaciones ejecutables. Los programadores los reciben como paquete estructurado y los industrializan al stack real.

**Paquete de entrega estándar a devs:**
- Código del prototipo (repo)
- README de negocio
- Diagrama de flujo del proceso
- Reglas de negocio documentadas
- Datos de ejemplo realistas
- Casos límite conocidos
- Video corto del prototipo funcionando (3-5 min)
- Reunión de handoff de 1 hora + canal abierto durante la industrialización

### 9. Plan de trabajo
- **Ahora:** alinear documentación con el estado real (Activos ya en producción, Integration Gateway con Cintelink, etc.).
- **Próximas 2 semanas:** migrar tablas `equipos_*` de la BD `fleetops` a nueva BD `activos`. Crear BD `hub` para usuarios centralizados.
- **Luego:** migrar usuarios de FleetOPS y Activos al Hub + módulo de Configuración General.

### 10. Gestión de herramientas Claude
- **Plan Max individual:** Projects no se comparten nativamente. Cada persona replica el Project en su cuenta bajando archivos del GitHub compartido.
- **Plan Team (5+ personas):** Projects compartidos. Evaluar cuando el equipo esté consolidado.
- **Source of truth:** siempre GitHub. Los Projects de Claude son copias de trabajo.

---

## Estado actual (Abril 2026)

| Módulo | Estado | URL | Puerto |
|--------|--------|-----|--------|
| Hub / Landing | ✅ Producción | `http://157.245.219.73` | 80 |
| FleetOPS | ✅ Producción | `http://157.245.219.73:8077` | 8077 |
| Integration Gateway | ✅ Producción (RedGPS + Cintelink) | interno Docker | 3100 |
| Activos | ✅ Producción | `http://157.245.219.73:8078` | 8078 |
| ERP | ⏳ Futuro | — | — |

---

## Pendientes y próximos pasos

1. Crear organización `ab-construcciones` en GitHub con la estructura de repos definida.
2. Cargar los documentos base al knowledge base del Project de Claude.
3. **Migrar BD:** separar tablas `equipos_*` de `fleetops` a nueva BD `activos`.
4. **Usuarios centralizados:** diseño del módulo de Configuración General + migración de usuarios al Hub.
5. Integrar Pajet al Integration Gateway cuando haya acceso.
6. Firmar PROTOCOLO-HANDOFF con los devs antes del primer handoff formal.
7. Resolver dominio propio para el VPS.
8. Backup externo (fuera del VPS).
9. Cambiar contraseña del usuario `admin` en FleetOPS.
