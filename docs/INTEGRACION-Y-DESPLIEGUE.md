# Integración y despliegue del corte de preparación

Plan de integración del 8 de septiembre de 2026. Describe el estado local y una secuencia propuesta; **no registra migraciones, activaciones ni despliegues de producción**. Los commits de revisión, las publicaciones de aplicación y las activaciones de controles son pasos diferentes.

## Punto de partida comprobado

- Worktree de trabajo: `C:\Users\amiun\Documents\Codex\folio-market-ready`, rama `codex/market-ready`.
- HEAD local: `b6e1da93595a58898874632e608d3d16bb016210`, documentación de recuperación sobre `2bfbe54137603e373a0fa2ab439d367dedf93415`.
- Referencia local `origin/master`: `a6eecc55a78c20310e30b2e1498aa28e11bc59b4`, hotfix #160 de llegadas/cobros. La base común es `2bfbe54`. No se hizo fetch en esta tarea: volver a consultar la referencia remota antes de integrar.
- Inventario previo a crear este documento: **204 archivos tracked modificados/eliminados y 281 archivos nuevos: 485 rutas**. La cifra no incluye archivos ignorados, secretos ni evidencia temporal de `.flow`; debe regenerarse al congelar el trabajo. `git diff` solo omite los archivos nuevos.
- Hay 18 migraciones nuevas, M98–M115, todavía presentes como archivos sin seguimiento. No tratar una migración o prueba sin seguimiento como parte de un commit ya respaldado.

El hotfix afecta diez archivos. `components/hoy/turno-list.tsx` y `turno-row.tsx` coinciden con `origin/master`. Los otros ocho requieren reconciliación: `dashboard.tsx`, `lib/turno-states.ts`, `package.json`, `pnpm-lock.yaml`, los tres archivos de `tests/hoy/` y `tests/unit/hoy-transition-replay.test.ts`. En el dashboard, el delta actual agrega el aviso/revisión de agenda M111; en la máquina de estados agrega logging saneado. Conservar ambos junto con el bloqueo de doble llegada, las transiciones pendientes y el cobro confirmado del hotfix. La mera presencia de un archivo no prueba que contenga su última versión.

## Preservar el trabajo e incorporar master

Procedimiento para ejecutar después de cerrar las ediciones concurrentes; **no fue ejecutado por esta tarea**:

1. Congelar temporalmente las escrituras de agentes. Guardar inventario exacto de tracked, eliminados y untracked, hashes y el HEAD/base. Conservar por separado la evidencia de pruebas y el estado de Git necesario para recuperación. Un parche de `git diff --binary` ayuda para tracked, pero no sustituye la copia de los archivos nuevos.
2. Confirmar la copia privada recuperable del workspace y su inventario. Las claves y `.env.local` se preservan mediante la custodia privada existente, fuera de commits y parches compartibles. No copiar `.env.local`, DPAPI, archivos descifrados o configuraciones reales a una rama, preview, fixture o log. Una copia de código no sustituye la copia de base/Storage.
3. Preparar una **copia de integración aislada**, conservando intacto el worktree original. Capturar allí el estado completo mediante selección explícita de archivos revisados y un checkpoint local de recuperación. No usar `git add .` como inventario; excluir artefactos, secretos y salidas de ejecución. Un checkpoint grande de custodia no es la entrega revisable final.
4. Construir la serie temática de la tabla siguiente desde la base conocida, conservando `b6e1da9` y su documentación. En esa copia, ya limpia y con los cambios preservados, integrar `origin/master` mediante una fusión normal de tres vías. No iniciar merge/rebase con 485 cambios sueltos, ni resolver con autostash, reset, `clean`, `ours`/`theirs` global o sustituyendo archivos completos desde una rama.
5. Resolver los ocho archivos solapados por intención y hunk. `package.json` y lockfile deben conservar los scripts/dependencias del hotfix y del aislamiento de pruebas; no escoger uno entero por comodidad. No volver a presentar #160 como un arreglo nuevo ni cherry-pickear a ciegas el mismo cambio sobre archivos que ya lo contienen.
6. Comparar el árbol integrado contra el checkpoint preservado y contra `a6eecc5`: cada diferencia debe corresponder al hotfix, a la integración o a una exclusión documentada. Ejecutar otra vez las pruebas de llegadas/cobros dev+prod y de sincronización de agenda, además de los controles globales del integrador.
7. Preparar PRs sobre el `master` actualizado. `master` despliega automáticamente: los commits temáticos pueden revisarse juntos en una rama, pero sólo se fusiona cada **release** cuando su fase de DB esté instalada y verificada. Conservar el checkpoint privado hasta cerrar publicación y recuperación.

No modificar migraciones ya aplicadas para facilitar una fusión. Si el inventario del destino muestra que alguna M98–M115 ya fue aplicada, detenerse y reconciliar su versión/contenido; este documento no sustituye esa comprobación. Los stashes existentes se inspeccionan por separado y los administra el integrador: no aplicar un stash completo sobre este árbol.

## Paquetes de revisión y commits propuestos

Los títulos son propuestas de commits convencionales, no commits creados. Cada paquete incluye sus pruebas y documento correspondiente. Los archivos transversales se dividen por hunks; una tabla no autoriza a copiar versiones enteras sobre otro paquete.

| Orden de revisión | Entrega / título propuesto | Archivos y migraciones principales | Dependencias de integración |
|---|---|---|---|
| 1 | `test: isolate local verification and builds` | `scripts/testing/*`, fixtures, configuración Playwright/TS/ESLint, workflows app-ci/pgtap, scripts de package/lock, pruebas E2E/visual aisladas | Conservar el runner y pruebas de #160; no incluir entornos reales. |
| 2 | `fix(security): close privileged and onboarding boundaries` | M98; portal/link/matcher, onboarding, eliminación de `api/admin/*` y seed-demo, controles de organización | Base para roles y linkage; las eliminaciones son parte de la entrega, no archivos olvidados. |
| 3 | `feat(auth): prepare staff MFA rollout` | M101; `lib/auth/mfa-*`, sesión/contexto/members, middleware, callback, `/seguridad/mfa`, guards de acciones | Prepara DB y todas las entradas humanas; instalación sin activación. |
| 4 | `fix(privacy): sanitize telemetry and errors` | Sentry/instrumentation, PostHog, `lib/observability/*`, `lib/db/errors.ts`, logging repartido | Incluir catálogo y consumidor juntos; no restaurar logs crudos al integrar otro paquete. |
| 5 | `feat(attachments): validate uploads and authorize downloads` | M102 y M104 con instalación apagada y activación posterior; `lib/db/documentos.ts`, `lib/storage/*`, ruta de archivo, galerías/especialidades, límite de next.config | M101 servidor; toda la cadena se instala antes del bundle, con cierre de SDK sólo tras smoke. |
| 6 | `feat(consent): record reviewed representation and signatures` | M103; evaluación, representación, firma, rutas y componentes/portal específicos | Helpers de Storage/MFA; activación independiente después de revisión clínica. |
| 7 | `feat(clinical): preserve history and save with revisions` | M105–M106; instrumentos/población, writers/contexto, coordinador de ficha, enmiendas, lectura completa, PDF/JSON clínico | M101/M103 y archivos UI compartidos con adjuntos; ciphertext/crypto conservados. |
| 8 | `feat(billing): persist provider operations and delivery receipts` | M99–M100; billing/MP, webhook, reconcile, `lib/email/*`, recordatorios, resultados de envío | Colas e idempotencia junto con consumidores; no revertir sólo el escritor tras crear intenciones. |
| 9 | `feat(calendar): reconcile complete snapshots and durable writes` | M107; Google OAuth/calendar/inbound/outbound/sync, webhook y cron | MFA, colas, consentimiento vigente; separar instalación de programación/llamadas reales. |
| 10 | `feat(finance): page and aggregate authorized movements` | M108; lectores/actions/UI/export financiero, dinero/filtros | RLS/MFA y montos consistentes; export completo o error. |
| 11 | `feat(booking): preserve family identity and atomic confirmation` | M109–M110; pedidos, reserva pública, intento del wizard, email de reserva | M100 para seguimiento; M109 elimina sólo unicidad telefónica, mantiene DNI. |
| 12 | `feat(agenda): synchronize revisions and protect availability` | M111 y M113; agenda-revision/monitor/tokens, hoy/calendario, horarios y onboarding paso5 | Integrar sobre #160; M113 comparte triggers de disponibilidad con M111, guard inicialmente apagado. |
| 13 | `feat(import): resume patient imports without duplicates` | M112; parser, acciones e interfaz importador | M109 y autoridad/MFA; recibos por fila no se eliminan al rollback. |
| 14 | `feat(directory): page and export the authorized patient set` | M114; directorio RPC/mapper/UI/actions/export | Crypto e índices actuales/rotación, MFA, colección completa; conservar contactos compartidos. |
| 15 | `feat(account): expose complete personal data outside billing` | `lib/me/personal-export.ts`, `/api/me/export`, `/mis-datos`, OwnDataPage, acciones/UI datos, enlaces billing | MFA, readCompleteCollection, límites y revalidación final; purge sólo revisión, sin borrado automático. |
| 16 | `feat(operations): prepare private monitoring and verified backups` | M115; `/operacion`, modelo/lectores/reportes; `scripts/backup/*`, `scripts/recovery/*` y tests | M99/M100/M107/M110 para fuentes; acceso operador separado, custodias/configuración nunca versionadas. |
| 17 | `docs: record release gates and clinical validation limits` | Plan, runbook, docs/piloto, recuperación, privacidad y evidencias de cada entrega | Corregir estado final tras pruebas globales; no convertir pruebas locales en promesa de producción. |

Migrations dentro de los commits temáticos conservan sus timestamps. **El orden de la tabla de revisión no es el orden de aplicación SQL.** Los cambios de `public/folio.css`, `next.config.ts`, `vercel.json`, `lib/crypto.ts`, `database.types.ts`, sesión, `paciente-detalle.tsx` y herramientas clínicas se reconcilian como dependencias compartidas, sin resucitar UI/handlers retirados.

## Secuencia DB → código → restricciones

### M104: instalación y activación separadas

El borrador M104 fue corregido antes de cualquier aplicación en producción: instala `folio_attachments_private.policy.enabled=false`. Sus restricciones conservan el acceso SDK/metadatos previamente permitido por RLS hasta una activación auditada de servicio. Así se puede instalar **M98–M115 en orden → desplegar el bundle completo → smoke autenticado → activar los controles**. No se necesita una publicación puente ni saltar/renumerar M104.

**Una DB que sólo tiene M104 instalada todavía no tiene cerrado el acceso directo a adjuntos.** La activación exige motivo, SHA completo del build desplegado y referencia explícita de revisión. Conserva el primer recibo y no ofrece desactivación. Si aparece cualquier evidencia de que el borrador anterior fue aplicado a un destino, no reemplazarlo allí: parar y preparar la reconciliación append-only correspondiente.

| Fase | Migraciones / código exacto | Gate para avanzar | Rollback compatible |
|---|---|---|---|
| A. Preparar | Confirmar historial remoto y baseline hasta M97; respaldo/custodia y restauración verificables; release sobre master actualizado | Inventario y prechecks por metadatos, claves recuperables, ensayos sintéticos y destino confirmado | No cambiar DB ni código si falta cualquiera. |
| B. Instalar expansión inicial | M98 `20260908162341`, M99 `20260908163016`, M100 `20260908163939`, M101 `20260908170427`, M102 `20260908172503`, M103 `20260908172934`, M104 `20260908174149`, en ese orden | MFA application_ready=false, enforcement staff nulo, consent enforced=false, attachments enabled=false. SDK antiguo conservado; revisar CHECK NOT VALID y anomalías legacy antes de escrituras | Mantener adiciones; no borrar colas/recibos. M98/M100 sí cierran privilegios indebidos inmediatamente: no revertir esas fronteras. |
| C. Completar DB, sin publicar aún | M105 `20260908174800`, M106 `20260908175754`, M107 `20260908175852`, M108 `20260908183408`, M109 `20260908183732`, M110 `20260908184053`, M111 `20260908190005`, M112 `20260908190255`, M113 `20260908192500`, M114 `20260908194000`, M115 `20260908200500` | Replay y prechecks del conjunto; population/session/availability guards sin activar. Planificar corte de productores/consumidores antiguos de proveedores | Mantener esquema/recibos/intenciones. No recrear unicidad de teléfono M109: puede haber familiares legítimos nuevos. No degradar a workers que ignoran recibos. |
| D. Publicar completo | Bundle integrado, todas las RPC presentes, nueva UI/acciones/consumidores, exports y /mis-datos | Smoke autenticado real sintético: adjuntos, roles/caja fuerte, límite multipart, cola/recepción idempotente, export y writers; resolver pestañas antiguas | Antes de activar, la DB conserva las vías legadas sujetas a RLS. Aun así un rollback debe respetar los contratos durables ya usados; el master previo no es universalmente seguro. |
| E. Activar por control | Adjuntos M104, MFA, consentimientos, población, escritor clínico y horarios: tabla siguiente | Cada control tiene su propio ensayo y registro de operador/motivo, sin PHI. M104 registra además SHA y referencia. Confirmar rechazo SDK después, manteniendo rutas nuevas operativas | Conservar versiones compatibles o suspender la función afectada mientras se corrige. No desactivar controles para volver al writer viejo ni abrir políticas automáticamente. |
| F. Operación piloto | Operador M115 revisado, fuentes/cuotas, reportero de respaldo y frecuencias de workers autorizadas | Recepciones/colas supervisadas, tareas realmente ejecutadas, recuperación y revisión clínica/legal cerradas | Pausar el consumidor afectado preservando trabajos, evidencia y seguimiento humano. No borrar jobs para poner el panel en verde. |

### Interruptores separados de la instalación

| Control | Estado al instalar | Activación auditada reservada al servicio | Prerrequisito y efecto sobre rollback |
|---|---|---|---|
| M104 adjuntos | `folio_attachments_private.policy.enabled=false` | `enable_clinical_attachments(p_reason,p_build_sha,p_reference)` | Build SHA de 40 hex minúsculas y referencia de revisión, con smoke de upload/download/rango/roles. Cierre unidireccional; metadata y GUC no alteran estado; sólo RPC administrativa puede activarlo. Después no volver al SDK directo. |
| M101 preparación MFA | `application_ready=false`, `staff_enforce_after=NULL` | `mfa_enable_preparation(p_reason)` | Publicar inscripción/desafío/recuperación y probar Auth real primero. Después las cuentas protegidas no vuelven a AAL1 por retirar la fecha de enforcement. |
| M101 todo el personal | Personal aún no enrolado puede prepararse antes de la fecha | `mfa_set_staff_enforcement(p_after, p_reason)` | Factores verificados y recuperación operativa; probar AAL1/AAL2, cuentas duales y sesiones/factores revocados. Rollback conserva MFA. |
| M103 consentimiento | `folio_consent_private.policy.enforced=false` | `consent_enable_reviewed_signatures(p_reason)` | UI/acciones/descarga nuevas + revisión profesional; cierra firmas sin evaluación y acceso directo a evidencia. Unidireccional. |
| M105 instrumentos | `population_policy.enabled_at=NULL` | `enable_instrument_population_policy(p_reason)` | Poblaciones/textos aprobados y writers compatibles; preserva históricos, no certifica validez clínica. |
| M106 sesión clínica | `folio_session_private.policy.enabled_at=NULL` | `enable_session_atomic_writes(p_reason)` | Dos pestañas, cambios de asignación/contexto, respuesta perdida, cierre/enmienda. Luego rechaza escrituras directas; no volver al escritor anterior. |
| M113 disponibilidad | `folio_availability_private.policy.enabled_at=NULL` | `enable_availability_revision(p_reason)` | Configuración y onboarding paso5 compatibles; smoke de franjas/vigencias/Córdoba. Luego M97 y escrituras directas autenticadas no eluden revisión. |
| M115 operadores | Allowlist privada sin altas automáticas | `operations_set_operator(...)` y capacidades/reportes administrativos revisados | OWNER de consultorio no equivale a operador. No habilitar usuarios por email hardcodeado ni declarar cuotas desconocidas como saludables. |

Las filas privadas de política y su historial se consultan al terminar cada activación. No ejecutar los ejemplos de funciones por el mero hecho de instalar el código. La política de respaldo/reportes M115 tampoco programa ni verifica una copia por sí sola.

## Dependencias y riesgos del corte operativo

- **M99 → M100 → M110:** cargo/seguimiento, envelope de correo y confirmación de reserva comparten recibos. Un pago o email incierto se resuelve consultando hechos/recibos; no reintentar manualmente con una identidad nueva. Planificar la finalización de invocaciones antiguas antes de cambiar consumidores.
- **M107 registra intenciones mediante triggers**, incluso antes de programar su worker. Durante una convivencia con sincronizadores antiguos, revisar los IDs/estado proveedor y evitar consumidores viejos y nuevos concurrentes. La instalación SQL no hace llamadas a Google, pero la posterior activación de una cola sí puede hacerlo. No borrar eventos ajenos ni intenciones pendientes para simplificar el corte.
- **M111 y M113 comparten disponibilidad:** conservar el marcador de agenda y la revisión de horarios. El hotfix de llegada/cobro y el acknowledgment SSR M111 deben coexistir.
- **M105/M106 y export clínico:** desplegar lectores, writers, contexto y UI juntos; la biblioteca del PDF y la del JSON no sustituyen una validación profesional de población ni una entrega binaria completa. Respetar los límites actuales de sus documentos.
- **Crypto y observabilidad:** claves reales fuera del repositorio; preservar compatibilidad de lectura y blind indexes durante rotación. No introducir una rotación junto al despliegue por comodidad. Mantener errores/logs saneados en todos los hunks incorporados.
- **Pruebas y CI:** conservar pruebas de fase expandida y enforcement, además del replay final con PostgreSQL16 por defecto. M104 debe probarse instalada sin quitar sus políticas y activada explícitamente dentro de transacciones de prueba que se revierten; la mera existencia de la migración no equivale a cierre.
- **Workers y planes:** el `vercel.json` actual conserva cinco crons, incluidos reconcile diario y watch-renew; no contiene `/api/cron/dispatch-email` ni `/api/cron/sync-google`, y retiró account-purge. No promete las frecuencias operativas requeridas. Validar el plan, coste y autorización antes de añadirlas; este documento no activa Pro ni programa tareas. Los workers existentes también requieren revisión al publicar código nuevo.
- **Baja:** `/mis-datos` evita el bloqueo por cobro para datos propios; account-purge queda en revisión sin borrado automático aunque una variable antigua esté encendida. No restaurar el cron destructivo al fusionar `vercel.json`.

## Gates humanos antes de declarar listo el piloto

- [ ] Inventario congelado y copia recuperable de tracked/untracked; custodia de claves y `.env.local` verificada sin subirlas al repositorio.
- [ ] `origin/master` actualizado y #160 conservado; evidencia de llegadas, pendientes, cobros y refresh sobre el árbol realmente integrado.
- [ ] Destino e historial SQL contrastados; prechecks de metadatos aprobados; timestamps canónicos registrados al aplicar cada migración.
- [ ] Toda la cadena M98–M115 instalada con controles de rollout apagados; ninguna automatización los activa por accidente. Build completo y smoke antes de M104, con su SHA/referencia registrados al habilitar.
- [ ] Replay global, tests, types, lint y build del integrador aprobados para cada artefacto que se publicará, no sólo para una versión anterior del worktree.
- [ ] Auth/TOTP/cookies/recuperación y Storage HTTP reales probados con cuentas y archivos sintéticos; roles revocados, caja fuerte y organizaciones ajenas rechazados.
- [ ] Personal informado y preparado para MFA; pestañas antiguas y escritores heredados resueltos antes de activar M106/M113.
- [ ] Profesional responsable aprueba consentimiento, representación, instrumentos y límites de entrega; soporte sabe tramitar exportaciones grandes y acceso clínico autorizado durante suspensión.
- [ ] Intenciones de pago, correo y Google reconciliadas; programación y configuración proveedor autorizadas por separado; supervisión de antigüedad y fallos disponible.
- [ ] Operador independiente habilitado mediante proceso revisado, cuotas con fuente/vigencia y estados desconocidos honestos; respaldo y restauración comprobados, no sólo una etiqueta de éxito.
- [ ] Versión de rollback compatible identificada para cada fase y responsables de recuperación disponibles. No hay borrado de pacientes, recibos, originales ni archivos históricos como mecanismo de recuperación.

Referencias del contrato implementado: [adjuntos](ADJUNTOS-CLINICOS.md), [MFA](MFA-ROLLOUT.md), [guardado clínico](GUARDADO-CLINICO.md), [horarios](HORARIOS-CONCURRENTES.md), [consentimientos](REPRESENTACION-CONSENTIMIENTO.md), [instrumentos](INSTRUMENTOS-POBLACION.md), [cobros](OPERACIONES-COBRO.md), [Google](GOOGLE-CALENDAR-CONFIABILIDAD.md), [operación](OPERACION-FOLIO.md) y [respaldos](RESPALDOS.md).
