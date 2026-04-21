# Documentación de FleetOPS

La documentación operativa específica de FleetOPS vive junto al código (READMEs, PROYECTO_CONTEXTO.md, SECRETOS.md).

## Documentación del ecosistema (movida)

Los documentos que antes vivían en `docs/ecosistema/` fueron extraídos a repositorios dedicados para que sean referenciables por todos los módulos del ecosistema (FleetOPS, Activos, Integration Gateway, Hub, futuros).

| Tema | Repo |
|------|------|
| Reglas de desarrollo, CLAUDE.md, consideraciones no-funcionales, protocolo de handoff | **`ab-dev-standards`** |
| Context map, bounded contexts, ADRs, plan de migración, deployment | **`ab-arquitectura`** |
| OpenAPI specs de los contratos entre módulos | **`ab-contratos-api`** |

## Por qué este cambio

Mantener los lineamientos dentro del repo de FleetOPS los ataba a la historia de commits de este módulo y dificultaba que otros módulos los referenciaran como fuente de verdad. Los repos dedicados permiten:

- PRs con review explícita sobre cambios de arquitectura sin mezclarlos con cambios de FleetOPS.
- Que un módulo nuevo clone los lineamientos desde el día uno.
- Versionado independiente de las reglas vs del código.

## ADRs

Las decisiones arquitectónicas registradas están en [`ab-arquitectura/adr/`](../../ab-arquitectura/adr).
