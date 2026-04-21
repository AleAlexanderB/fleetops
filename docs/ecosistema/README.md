# Paquete de documentos — Ecosistema AB Construcciones

Este paquete contiene los documentos base del ecosistema de sistemas internos de AB Construcciones SRL.
**Última actualización:** Abril 2026

---

## Contenido

| Archivo | Qué es | Dónde va |
|---------|--------|----------|
| `00-RESUMEN-CONVERSACION.md` | Síntesis de todas las decisiones tomadas | Knowledge base Project Claude + repo `ab-arquitectura` |
| `02-ARQUITECTURA.md` | Context map del ecosistema: sistemas, dependencias, bounded contexts, contratos | Repo `ab-arquitectura` + knowledge base |
| `03-CONSIDERACIONES.md` | Requisitos no funcionales y reglas transversales a todos los módulos | Repo `ab-dev-standards` + knowledge base |
| `04-PROTOCOLO-HANDOFF.md` | Protocolo formal de entrega de prototipos a devs de producción | Repo `ab-dev-standards` + knowledge base |
| `05-DEPLOYMENT-ACTUAL.md` | Estado exacto del servidor, URLs, usuarios, comandos operativos | Repo `ab-arquitectura` + knowledge base |
| `06-PLAN-MIGRACION.md` | Plan de migración: BDs separadas + usuarios centralizados en Hub | Repo `ab-arquitectura` |
| `CLAUDE.md` | Archivo maestro para pegar al inicio de cualquier conversación con Claude | Knowledge base del Project + raíz de cada repo |

---

## Cómo usar este paquete

### Paso 1 — Crear el Project en Claude.ai

1. Entrar a `claude.ai` → Projects → New Project.
2. Nombre: **"Ecosistema AB Construcciones"**.
3. En **Instrucciones del Project**, pegar:

```
Ecosistema de sistemas internos de AB Construcciones SRL (Jujuy, Argentina).
Stack: React+Vite / Node+Express / MySQL 8.4 / Docker.
BDs separadas por módulo dentro de una única instancia MySQL.
Usuarios centralizados en el Hub (módulo de Configuración General).
Integraciones externas (RedGPS, Cintelink, Pajet futuro) pasan por el Integration Gateway.
Equipo mixto: expertos de proceso que prototipan con Claude + devs que industrializan.
Timezone siempre Argentina (America/Argentina/Jujuy).
Ver knowledge base para contexto completo. Nunca avanzar fases sin confirmación
explícita. Siempre entregar archivos descargables.
```

### Paso 2 — Cargar el knowledge base

Subir al knowledge base del Project todos los archivos de esta carpeta.

### Paso 3 — Crear repos en GitHub

En la organización `ab-construcciones`, crear:

```
ab-construcciones/
├── ab-arquitectura          ← 00-RESUMEN, 02-ARQUITECTURA, 05-DEPLOYMENT, 06-PLAN-MIGRACION
├── ab-dev-standards         ← 03-CONSIDERACIONES, 04-PROTOCOLO-HANDOFF, CLAUDE.md
├── ab-contratos-api         ← OpenAPI specs (a poblar)
├── fleetops-v2              ← FleetOPS (este repo contiene este paquete en docs/ecosistema/)
├── ab-equipos               ← Sistema Activos (ya existe en GitHub)
├── integration-gateway      ← Microservicio único de integraciones externas
├── hub-ab                   ← Hub + módulo Configuración General
└── erp-ab                   ← futuro
```

### Paso 4 — Completar lo que falta

Pendientes antes de arrancar el primer handoff formal:

- [ ] Ejecutar plan de migración (BDs separadas + usuarios en Hub) — ver `06-PLAN-MIGRACION.md`.
- [ ] Reunión con devs para acordar últimos detalles técnicos pendientes.
- [ ] Asignar responsable técnico ("dueño técnico") a cada sistema.
- [ ] Cambiar contraseña del usuario `admin` en FleetOPS.
- [ ] Configurar dominio propio para el VPS.
- [ ] Implementar backups externos (fuera del mismo servidor).
- [ ] Integrar Pajet al Integration Gateway cuando haya acceso.

---

## Para Claude Code — al inicio de cada sesión

```bash
# 1. Copiar clave SSH:
cp "E:/VIAJES OyD/fleetops-v8-work/fleetops-v2/server_key" /tmp/server_key && chmod 600 /tmp/server_key

# 2. Verificar que el servidor está OK:
ssh -i /tmp/server_key -o StrictHostKeyChecking=no root@157.245.219.73 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```
