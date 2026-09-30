# Folio — tablero único de lanzamiento

Actualizado: 30/09/2026, 01:19 UTC. Autoridad operativa: esta copia en `codex/launch-checkpoints`. [AVANCES](AVANCES.md) contiene los 19 checkpoints y la vista breve del titular. Las fechas de esta página son comprobaciones, no estado en tiempo real.

## Objetivo y método

Lanzar Solo y Clínica, cinco especialidades, Google y portal para adultos; pacientes nuevos primero. Menores, WhatsApp automático, agentes operativos y traslado histórico desde Coofit quedan después. Priorizar riesgo, dependencias, utilidad y esfuerzo restante; cerrar con evidencia y tomar el siguiente paquete útil, sin semanas rígidas ni repetir controles vigentes. Piloto final: 14 días, tres profesionales, al menos cinco jornadas por persona y sin problemas graves pendientes.

A dirige prioridades, aceptación y presupuesto. Máximo dos escritores aislados; cada encargo fija base, archivos, dependencias, entorno, pruebas y cierre. Revisión independiente en cambios relevantes. B, D, Legal/SEO y Landing fueron actualizados a `gpt-6.1-sol` High por herramienta; no afirmar un modelo no verificado para C. Cuota 30/09 01:03UTC: 51% usada, 49% disponible, reserva15%; consumo compartido, no atribuible exactamente por agente. Al85% usado no abrir implementación, preservar/cerrar y pausar la automatización si estuviera activa.

Automatización `folio-manager-por-checkpoints`: PAUSED, sin modificar esa preferencia. Continuar directamente mientras haya trabajo útil; no esperar la hora ni prometer ejecución ininterrumpida.

## Equipo y siguiente acción

| Área | Estado y siguiente paso |
|---|---|
| B · Producto | Implementa M150/editores atómicos desdee0f3+CAS congelado en d05. Una migración/3RPC y mismos editores; aún sin ensayo SQL nuevo autorizado. A revisa candidato antes del ensayo hospedado. |
| D · Experiencia | UI incorporación39c952a cerrada aislada. Ahora implementa revalidación final de descarga portal desdea60 en copia nueva, tres archivos. A asigna revisión al congelar. |
| C · Continuidad | R8 instalado y reconciliado; cupo libre. No repetir captura ni comprobaciones por rutina. Próxima automática01:57 sólo se observará cuando ocurra durante trabajo útil. |
| Legal/SEO | S1 hospedadoPASS; publicación preparada, bloqueada por lectura actual de filtro Supabase. P1/L4/H3 retenidos. Sin agentes esperando activamente. |
| Landing | Diez pasadas cerradas, propuesta4441 revisada; valoración creativa del titular pendiente. Sin integración/publicación ni otra iteración por inercia. |

Escritores actuales: **B y D**. C, Legal y Landing no tienen implementación abierta. Si el titular asigna trabajo directo en otro chat, sincronizar alcance/cupo y preservar esa decisión.

## Producción y publicaciones

- Master comprobado `a60f86a16aefa23fc56b5920c567f92adae4c368`, árbol `4d24aa2db10659a20fdd9b5b7f668b9d64529012`: [PR189](https://github.com/OsoCordobes/FolioApp/pull/189), sólo vía de CI aislada con SHA obligatorio. App36637801788/SQL36637801866PASS; SupabasePreviewSKIPPED. Vercel `dpl_2q1g1DGC3H8GHNmwbYswgGK8ACmK` READY/production/git/gru1 y ambos dominios. No repetir smoke.
- [PR188](https://github.com/OsoCordobes/FolioApp/pull/188) retenida: candidato `56a15725dc6229a26368b26f8e58963a3252847e`, tree `d74b5b6d40b5aac71fb813fb2705512f63e0bbc8`. CI/revisión vigentes; gate de copia reciente satisfecho, **H3 sigue abierto**. Último ledger productivo29/09 19:21:138 hastaM146; M147 ausente, Preview139. Revalidar master/ledger antes de cualquier acción futura.
- Operador M147 `apply-b09-m147.mjs`, hash7316dbf1a930b090ab0e49fe14a16808022039d5248838ff723e1fc67345f6f3; readiness `m147-publication-readiness-56a1572.json`, hash357559e882ec7cc56682cd3a2578efdae32f6a24cfd589d1e3af6782fb5fa594. Cuando H3 se resuelva: preflight fresco/base y pins → única aplicación/COMMIT/readback → squash → árbol/deployment. No repetir autorizaciones consumidas ni incluir M148/S1/legal en esa PR.
- PR165/checkpoint19/09 es histórico cerrado. M106/M120/M121/M144/M145/M146 no se reaplican. PR182/exportación profesional y PR167/recuperación sintética siguen publicadas/cerradas según AVANCES; no degradarlas por documentos antiguos o pruebas posteriores heredadas.

## Respaldo: estado actual cerrado

Raíz privada `C:/Users/amiun/folio-recovery/initial-20260908-182017`; tarea `Folio - respaldo cifrado`.

- Nueva copia `backup_20260930T002929896Z_7bf8dc0a-b1e1-4818-9f69-1aad7d18d1f2`, terminada00:33:12.469Z, completa/autenticada. Verification SHA d220957c5be274d260b0b0ee59595e9b228aa1b7f8aa0d9c31654ce00821b100; last-success340f6f4d2c3ace37ee14b82cb46473061ceb1e1ee8e9fdde0981f76b080f07e5. Cuatro copias y138incompletos preservados. R7 tuvo éxito durable pero falló su wrapper/informe: no ocultar ni repetir ese intento.
- R8 UpdateOnly **consumido una vez**01:10:47–01:10:53; exit0, Update1, Start0/captura0/statusmanual0/retry0/rollback0. Principal usa runtime `backup-runtime-20260929T2034-r1-reviewed-timeout300-one-shot`, probado previamente, único delta captura180s→300s. Manifest e63d36ca157091a53efc3613da438bc6ff706acd3e4a615031def874e41ebe50; launcher7a7c777d77951d976ef010480de2ab14201d497169e5bf54078226a389484aec.
- CAS actual `b6f8b7f844c582178e810dda04d520cdc601c5fa6cb4f00faffc02d6023187b3`. Readback01:11:51:28/28checks/revisiónPASS, identidad/triggers/PT20M/IgnoreNew intactos, sólo acción/descriptor cambiados. XML anteriorafcc868eb673134beb671babefaa0fd072c251f4cdd14652b4a473273e801f89 preservado.
- Evidencia en `C:/Users/amiun/Documents/Codex/folio-b09-evidence/`: `r8-runtime-timeout300-updateonly-execute-v1.json` SHA7db76430c6d776b910d45ff04801bffb663f21fc8c4c473eb14e222583bae327; `...-reconciliation-v1.json` SHA6bc970dd0d26ad4bc9e8e0cb0b0900cf08fbd6d96ecdbb48fd785ad0e32e64e6; `...-execute-independent-review.md` SHAba6cf36de31043fc101a3875223a56bf419bc99e1edc67638b096b4cd577f4a5. A leyó/hasheó los tres.
- Automática00:57:LastResult0/verification_attention/not_due, copia nueva vigente; recibo `r8-runtime-timeout300-automatic-reconciliation-v1.json` SHA72c5253241e6ab29073769463bf2c2d60897a277f92ea209ded574d60c37039d. Advertencia histórica legítima por incompletos, no borrar para obtener verde. Próxima01:57 no observada ni anticipada. restorationProven=false pertenece a esta copia productiva, no invalida C01. Custodia externa/configuración integral pendientes.

## Incorporación de ficha y editores

Evidencias locales: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/`.

**Cerrado:** DB M148/M149 sobre79a97f86f2b8b2ad3bd30b7a152641497cfa26d1, [run36644027135](https://github.com/OsoCordobes/FolioApp/actions/runs/36644027135):141migraciones/84specs/4runnersPASS PG16 sintético. `m148-pg16-run5-pass.md` SHA78a1b7cbee23f5a5b4afb6df5b716dc597a9fff82002dc198f768b3315e8b2da. Intentos1/2 hallaron defectos SQL reales;3/4 fallaronfixtures; todos preservados. M148/M149 aplicadas son inmutables. No acredita HTTP/UI/producción/H3.

**Cerrado mapper/server:** `e0f3b93d4673fc60feaada4281e4a1ddebe1b69e`, tree356119749fac7a61066989669e9e29e7fbbde1d2,36/36tests/tipos/lint/revisiónPASS. Entrega `m148-mapper-server-candidate-e0f3b93.md` SHAd7803c74bac28cf154c2e338ca52ca14b6f069ea1473bf0bf6aace846037131a. API congelada; fallo de reconciliación conserva outcome incierto. Sin publicar.

**Cerrada UI D:** `39c952a3bd403f98aa1ab5c4ac5db4aea687e7d3`, tree0ea57330e3373bdb5e5a6ff10886200f2f25b8cc, basee0f3; checkout `m148-intake-comparison-ui/folio-app` limpio. Siete archivos,8unit+9componente/2rechecks, tipos/lint/revisión y capturas1280/390/320. Manifest `m148-ui-manifest-39c952a.json` SHAfb8e339a9b446b1a227ba405606829ddafb558356c5d50651837ce2722b7cf81; A contrastó15hashes/logs/capturas. Componente real, acciones sintéticas/loopback, no backend. `incorporationEnabled=false` por defecto; caller `turno-detalle-modal.tsx` intacto. Activar con capacidad existente sólo tras CAS/backend/gates y ensayo hospedado integrado.

**B activo — M150:** d05/folio-app, `codex/m148-editor-cas`, basee0f3 + diff congelado `m148-editor-cas-frozen.patch` SHAec4458ba51ea9ef53385b6bb7370e6d8c808a7d3d5853262a877985a420332fc. Inventario máximoM149; B creó M150 porCLI. Carrera confirmada por fuente: pacienteP cambiaI1→I2 sin subir admin_revisionI1 y UPDATEI1 puede confirmar antes del recheck. Portal requiere ademásQ→I1 por UNIQUE, no dos vínculos simultáneos. No incidente observado. Contrato revisado `editor-cas-atomic-contract-review-20260930.md` SHA0e14d52fa0f33d4a55720cc7222059ead5025d791da1074a67f5acaaa58feee1.

Autorizado sólo implementar: una migración/3RPC contacto staff, cobertura staff, contacto portal; wrapper INVOKER mantiene DML bajo RLS, helper restringido de locks/autoridad sinPII/DML elevado. Ambas revisiones admin/identity_link textuales, snapshot coherente, MFA condicionalM101 y propiedad portal vigentes. Revisiones >2^53 sin Number; par email cifrado/hash, nullability y alcance conservados. Ante40P01 conservar borrador/rollback sin retry ciego; M93 invierte orden de locks: riesgo inferido a probar, no modificar su política aquí.

Archivos propios B: `lib/db/{paciente-ficha,pacientes,portal-perfil}.ts`, pacientes/actions, paciente-detalle/contacto-modal/cobertura-modal, portal/perfil actions/perfil-list, dosunits, unaSQLspec/unrunner. Sin APIe0f3/UI D/workflows/env. Pruebas locales focales/tipos/lint; preparar casos de reasignación/ABA/CAS/intake/revocación/M93 con barreras. A revisa candidato antes de **nuevo ensayo hospedado al SHA exacto**; SQL preparado no es PASS. Sin DB conectada/Docker local/push/PR/producción.

## D activo — descarga del portal

Base autorizada `a60f86a16aefa23fc56b5920c567f92adae4c368`, copia nueva aislada sinM148, conservarUI39. Hallazgo fuente: ruta ensambla/audita y devuelve sin revalidación final de cuenta/vínculos. No incidente observado ni prueba concurrente todavía.

Sólo `app/api/portal/export/route.ts`, nuevo `lib/patient/portal-export-authorization.ts`, nuevo `tests/unit/portal-export-route.test.ts`. Capturar conjunto completo bajo RLS (usuario/cuenta/paciente/org/identidad), ensamblar/serializar, auditar, revalidar Auth/política MFA ACTUAL y conjunto antes de devolver. Deriva rechaza sin datos ni attachment. Sin ampliar historia/binarios/URLs/menores ni imponer MFA clínica staff. Handler real con fronteras controladas: multi-org positivo; sesión/cuenta/revinculación/identidad durante auditoría; errores sinPII/no-store/SOAP ausente. Tipos/lint y revisión independiente A cuando congele. Sin SQL/DB/Docker/proveedores/push/PR. Lecturas sucesivas no prometen atomicidad global ni revocación retroactiva de bytes.

## Pendencias externas y vistas

- **S1 probado, no publicado:** release18f4869c69fc84877c869585822b041b4bfdadaf/tree13b86f4464d7d83c9e764d7803e0e8aeb1361ef0; wrapper operativo21a784e1691151a0361428999698d669bc56dc48 nunca se integra. [Run36650012231](https://github.com/OsoCordobes/FolioApp/actions/runs/36650012231),3PASS/0SKIP, password/TOTP/AAL2/HTTP200 real de Hoy+Portal/head noindex,nofollow/restauración/cleanup contractual; no inventario post-down. Evidencia `s1-auth-21a784e16911-2/`; primerfallo conservado, ceroPreview/deployments. Operación `s1-publication-operation-20260930.md` preparada. Falta leer **Automatic branching, Supabase changes only, Working directory** de integraciónGitHub grkpayhxndztlfwxobnt; pregunta al titular pendiente. PR189SKIPPED acredita entonces, no la configuración actual. CUA no inicia por assets/ruta; URL abierta queued, no inspección lograda. Sin PR para averiguar si crea entorno pago.
- **H3:** [hechos de proveedores](PROVIDER-FACTS-20260929.md), SHA34c7c462d792d341486a7f24f07a0a2656656a4c086c79513703b81d66ccf53f. Restricción de datos sensibles del DPA públicoVercel y tránsito de salud en ServerActions requieren aclarar cobertura aplicable; no afirmar infracción probada ni equiparar BAA/HIPAA con permiso argentino. Consulta escrita preparada, autorización para enviarla pendiente. Piloto real/nueva recolección clínica retenidos; no apagar/migrar/comprar por inferencia. Supabase productivo sa-east-1/Free, Vercelgru1; usuario informóPro, no confundir región con residencia exclusiva.
- **P1/L4:** cookies/mapa/preferencias preparados en ae38; vista previa4410/cookies (comprobación anterior). Privacidad§8 conserva preaviso30d: asesoría/titular resuelven vigencia/aviso y responsable legal/país. Pregunta pendiente; no inventar notificación. Propuestas legales son borradores.
- **Landing:** [propuesta local4441](http://127.0.0.1:4441/), diez pasadas pedidas por titular, dosrevisores/cincoanchos/ocho casos de motion. Artefacto `C:/Users/amiun/.codex/visualizations/2026/09/26/01a0df9c-b1cd-7682-b37b-f0d670f7516e/folio-directions/`; README1bc9a6f9, ITERATIONS85b0e629, HTMLb1f394e9; hashes completos en historial. Capturas finales cinematic-full-desktop/cinematic-frozen-mobile contrastadas. Tests usan fallbacksinWebGL; no certificaciónGPU. Repo64d2/4387366 intacto; valoración creativa pendiente, sin servicios reales ni publicación.
- Google, correo, pagos, custodia externa, criterio clínico y piloto mantienen gates de AVANCES y contratos existentes. No confundir preparación con prueba real.

## Chats, seguridad y antecedentes

| Chat | ID / checkout relevante |
|---|---|
| B — Acceso y producto de Folio | 01a0bb34-d7b9-7841-b45c-1889b0b987dd · d05; PR188 en folio-adult-revocation |
| C — Continuidad y proveedores de Folio | 01a0bb34-d802-7852-82c5-126c0af7e654 · ede1 |
| D — Experiencia y verificación de Folio | 01a0bb34-d7b9-7841-b45c-189d01589d14 · UI m148-intake-comparison-ui; nuevo checkout portal pendiente de recibo |
| Folio — Landing premium en vivo | 01a0df9c-b1cd-7682-b37b-f0d670f7516e ·64d2 |
| Folio — Legal, privacidad, SEO y rendimiento | 01a0dfc7-8b7d-73f1-9321-2ce5d9a59371 · S1 s1-authenticated-indexing; legal ae38 |

Panel4420 detenido: HTTP rechazado/PID ausente. Reinicio Hidden fue rechazado por aprobación automática sin razón específica; **no eludir ni delegar otro camino**. AVANCES disponible en Git; open_in_codex devolvió queued, no confirma panel visible.

Seguir AGENTS y RTK.md, originales para decisiones consecuentes. No iniciar/resetear Docker local ni borrar bases/volúmenes/backups/fixtures/evidencia/archivos ajenos. No imprimir secretos/sobrescribirenv/restaurar Upstash viejo; DPAPI depende de Windows. Migraciones aplicadas inclusoPreview inmutables; rollout aditivo→código→enforcement con COMMIT/readback. Comunicaciones, cargos, Google, compras y decisiones clínicas requieren autorización trazable específica; una entrada de tablero no la otorga. Entrega global de correo sigue apagada.

[Auditoría de instrucciones](AGENT-SETUP-20260926.md) cerrada90/100; Flow sin almacén/no-op. No repetir. [Preparación de piloto](D-CALIDAD-PILOTO.md) no es aprobación profesional.

Historial íntegro de este corte: [archivo30/09 01:19](LAUNCH-BOARD-HISTORY-20260930-0119.md), SHA256`ad2627ddeb1fc751bb6828630acdf5723ac39e13bc4693d3260157760d4d583e` (64208bytes, copia exacta antes de compactar). Historial previo: [archivo29/09 20:50](LAUNCH-BOARD-HISTORY-20260929-2050.md), SHA256`f725a510211fce532871057d83063ad800f7ea419c1ebd537f2070fa93c767a0`. Consultarlos sólo para evidencia necesaria; autorizaciones pendientes de sus fechas ya pueden estar consumidas. Esta página y recibos actuales prevalecen como estado, sin borrar fracasos ni antecedentes.
