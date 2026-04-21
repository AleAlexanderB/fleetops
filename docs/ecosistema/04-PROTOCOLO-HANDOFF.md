# PROTOCOLO DE HANDOFF — Entrega de prototipo a devs de producción

> **Propósito:** Definir el proceso formal de entrega cuando un experto de proceso finaliza un prototipo y lo pasa a un programador para industrializar a producción.  
> **Audiencia:** Expertos de proceso (entregan) + devs de producción (reciben).  
> **Fuente de verdad:** Versionado en `ab-dev-standards/PROTOCOLO-HANDOFF.md`.  
> **Última actualización:** Abril 2026

---

## Por qué existe este protocolo

Los desarrollos demoran o fallan cuando los programadores no entienden el proceso de negocio y los expertos de proceso no pueden explicarlo en términos técnicos. Este protocolo crea un puente: el experto construye un prototipo que *muestra* el negocio funcionando, y el dev recibe un paquete estructurado que le permite entender sin necesitar conocer el negocio de antemano.

El prototipo **no es** código de producción. Es una **especificación ejecutable**: demuestra qué debe hacer el sistema, con qué lógica, en qué orden, con qué casos límite. El dev lo industrializa al stack real.

---

## Fase 1 — El experto construye el prototipo

### ¿Qué es un prototipo funcional?
Un prototipo funcional es una aplicación que:
- Tiene una UI navegable (aunque sea simple).
- Implementa la lógica real del negocio (no un mockup estático).
- Corre con datos realistas (no solo "lorem ipsum").
- Muestra los casos especiales y excepciones del proceso.

### Cuándo el prototipo está listo para handoff
- [ ] Cubre el 80%+ de los casos de uso del proceso.
- [ ] Los casos límite conocidos están documentados (aunque no todos estén implementados).
- [ ] El experto puede hacer una demo de 5-10 minutos sin preparación.
- [ ] Las reglas de negocio están documentadas por escrito (no solo en el código).

---

## Fase 2 — El paquete de entrega

Antes del handoff, el experto arma el siguiente paquete y lo sube al repo `prototype-{sistema}`:

### 2.1 Código del prototipo
- Repo limpio con `README.md` básico de cómo correrlo localmente.
- `.env.example` con todas las variables necesarias.
- Datos de ejemplo incluidos (fixture o seed script).

### 2.2 README de negocio (`NEGOCIO.md`)
Explica, en lenguaje de proceso (no técnico):
- **Qué problema resuelve** este sistema.
- **Quiénes son los usuarios** y qué hace cada rol.
- **El flujo principal** paso a paso: qué hace el usuario, qué hace el sistema, qué pasa en cada caso.
- **Las reglas de negocio** que no son obvias (ej: "un equipo con documentación vencida no puede asignarse a un viaje", "si el viaje no tiene chofer asignado, el sistema asigna automáticamente el último chofer conocido").
- **Los casos límite** conocidos y cómo se manejan.
- **Lo que no está implementado** en el prototipo (scope del prototipo vs. scope del sistema real).

### 2.3 Diagrama de flujo del proceso
Un diagrama (puede ser hecho en Draw.io, Mermaid, o incluso a mano escaneado) que muestre:
- El flujo de trabajo del usuario.
- Las decisiones del sistema.
- Los estados posibles de cada entidad principal.

### 2.4 Datos de ejemplo realistas
- Al menos 3-5 casos de uso representativos con datos reales (anonimizados si es necesario).
- Al menos 1-2 casos límite que el sistema debe manejar.
- Formato: SQL seed o JSON fixture.

### 2.5 Video de demo (3-5 minutos)
Grabación de pantalla donde el experto:
1. Explica el flujo principal mientras lo recorre en el prototipo.
2. Menciona las reglas de negocio importantes al pasar por ellas.
3. Muestra al menos un caso límite.

El video se sube al repo (o a un drive compartido) con link en el README.

### 2.6 Checklist de entrega

```
CHECKLIST DE ENTREGA — prototipo {nombre_sistema} v{version}
Fecha: ___________
Experto que entrega: ___________
Dev que recibe: ___________

PAQUETE:
[ ] Código del prototipo subido al repo prototype-{sistema}
[ ] README de negocio (NEGOCIO.md) completo
[ ] Diagrama de flujo incluido
[ ] Datos de ejemplo / seed incluidos
[ ] Video de demo grabado y accesible
[ ] Casos límite documentados

VALIDACIÓN PREVIA:
[ ] El prototipo corre sin errores con el seed de datos
[ ] Los flujos principales funcionan end-to-end
[ ] El experto hizo una demo sin preparación y funcionó

FIRMA:
Experto: ___________  Fecha: ___________
Dev:     ___________  Fecha: ___________
```

---

## Fase 3 — Reunión de handoff (1 hora)

### Agenda estándar
1. **[0-10 min]** El experto presenta el negocio: qué problema resuelve, quiénes lo usan, contexto de AB Construcciones relevante al sistema.
2. **[10-30 min]** Demo en vivo del prototipo: el experto navega el sistema mientras explica la lógica de cada paso.
3. **[30-45 min]** Preguntas del dev: el dev pregunta todo lo que necesita entender para implementar. El experto responde.
4. **[45-55 min]** Acuerdo de scope de la primera versión de producción: qué entra en v1, qué queda para después.
5. **[55-60 min]** Canal de comunicación y proceso de consultas durante la industrialización.

### Reglas de la reunión
- El dev NO debe hacer preguntas técnicas sobre el stack del prototipo (ese código se descarta).
- El experto NO debe tomar decisiones técnicas de implementación ("debería usar PostgreSQL" → no aplica).
- Toda pregunta de negocio que surge en la reunión y no tiene respuesta clara se anota como **"pendiente de definición"** y se responde antes de que el dev implemente esa parte.

---

## Fase 4 — Canal de soporte durante la industrialización

- El experto queda disponible para consultas por **4 semanas** después del handoff.
- Canal de comunicación: [definir por equipo — WhatsApp, Slack, email].
- El dev documenta las consultas y respuestas en el repo `production-{sistema}` (archivo `DECISIONES-IMPLEMENTACION.md`).
- Si surge una decisión de negocio importante durante la implementación, se actualiza `NEGOCIO.md` en el prototipo.

---

## Fase 5 — Validación del sistema de producción

Antes de dar por finalizado el handoff:
1. El experto prueba el sistema de producción con datos reales.
2. Verifica que el comportamiento coincide con el prototipo en los flujos principales.
3. Firma el checklist de aceptación.
4. Si hay discrepancias: se abre una issue en el repo `production-{sistema}` y se prioriza en el siguiente ciclo.

---

## Registro de handoffs realizados

| Sistema | Versión | Fecha | Experto | Dev | Estado |
|---------|---------|-------|---------|-----|--------|
| FleetOPS | v1-v9 | 2025-2026 | Alejandro | Alejandro (mismo) | ✅ En producción |
| Activos (repo `ab-equipos`) | v1 | Abril 2026 | Alejandro | Alejandro (mismo) | ✅ En producción, pendiente handoff formal a dev de producción |
| Hub + Configuración General | v1 | *(pendiente)* | Alejandro | *(por asignar)* | 🔄 En diseño |

> Nota: FleetOPS y Activos fueron prototipados e industrializados por la misma persona. El protocolo de handoff aplica cuando son personas distintas. Documentar igual para consistencia — el próximo candidato para handoff formal es el módulo de Configuración General del Hub.

---

## Excepciones a este protocolo

- **Sistema muy simple** (menos de 3 pantallas, sin reglas de negocio complejas): puede omitirse el video y el diagrama. El NEGOCIO.md y el paquete de datos son siempre obligatorios.
- **Prototipo en etapa muy temprana** (exploración inicial): no hace falta paquete completo; alcanza con la reunión informal y tomar notas.
- **El experto y el dev son la misma persona** (caso FleetOPS): documentar igual las reglas de negocio en NEGOCIO.md para que futuros devs entiendan el sistema.
