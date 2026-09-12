# Checkpoint previo al release del rediseño

12 de septiembre de 2026, inventario consultado aproximadamente a las 20:22 UTC. **Integración y despliegue del rediseño pendientes** al escribir este documento; no se declara publicado ni listo el lanzamiento con pacientes reales.

## Corte del rediseño

La rama `codex/folio-experience` conserva el rediseño hasta `2d02096390d4481c2207ff192eaae4522bf8ec69`, precedido por `8f1a6d5` y `f98b116`. Se prepara su integración en `master`, que al consultar coincidía localmente y en GitHub en `a0fe34e6853d42c5072741584775983de4f7bc53`. La documentación y evidencia final se incorporan al cierre. La comprobación de merge, CI y despliegue corresponde al paso siguiente.

## Ramas y preservación

| Rama | Estado verificado |
|---|---|
| `master` | `a0fe34e`; coincide con GitHub. |
| `codex/market-ready` | `ae1d9bd`; HEAD local y remoto idénticos. Conserva trabajo de preparación aún no publicado. |
| `codex/folio-experience` | `2d02096`; sin rama remota visible en el inventario previo al PR. |
| `codex/launch-reliability` | `e7da69f`; nueve commits propios respecto de market-ready, sin rama remota ni PR en ese inventario. El trabajo de confiabilidad («trust») sigue activo y separado del release visual. |
| `codex/walk-in-arrival` | HEAD exacto integrado por [PR #160](https://github.com/OsoCordobes/FolioApp/pull/160). |
| `codex/checkpoint-septiembre` | HEAD exacto integrado por [PR #161](https://github.com/OsoCordobes/FolioApp/pull/161). |
| `codex/walk-in-modal-smoke` | HEAD exacto integrado por [PR #162](https://github.com/OsoCordobes/FolioApp/pull/162). |
| `codex/billing-authority-fix` | HEAD exacto integrado por [PR #163](https://github.com/OsoCordobes/FolioApp/pull/163). |

Los cuatro PR figuran MERGED y sus `headRefOid` coinciden con las ramas locales; no se dedujo un squash merge por ancestry. Sus ramas remotas fueron eliminadas, pero las locales se conservan. Se encontraron siete worktrees, ningún stash y ningún PR abierto en ese momento.

`folio-reliability` también contiene progreso **sin commit**: `LAUNCH-RELIABILITY-LOG.md`, el plan `2026-09-12-close-callers-recovery.md`, la migración `20260912200817_M120_turno_close_atomic.sql` y tres archivos de fixture/pruebas. `folio-clinical-runtime` está detached en el mismo `e7da69f`. Estos cambios no deben incorporarse incidentalmente al rediseño. El bundle local de todas las referencias está previsto como respaldo adicional; un bundle de referencias no incluye por sí solo archivos sin commit.

## Estado de preparación consultado

Se leyó `C:/Users/amiun/Documents/Codex/folio-market-ready/docs/ESTADO-ACTUAL.md`. Ese documento registra producción en PR #163 y M118 aplicada; M98–M117 y M119 siguen pendientes. La rama amplia mantiene el despliegue automático desactivado deliberadamente.

Continúan pendientes el recorrido clínico autenticado con Supabase local real, la comprobación del control comercial de escrituras y proveedores, la restauración integral y la validación profesional/operativa previa al piloto. Las pruebas visuales, aisladas y de compilación del rediseño no sustituyen esas verificaciones ni autorizan aplicar las migraciones pendientes.

Este checkpoint documenta preservación y separación de alcance. No modifica otros worktrees, datos, migraciones ni producción.
