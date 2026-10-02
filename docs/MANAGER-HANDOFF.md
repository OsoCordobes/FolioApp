# Folio · relevo del manager

**Borrador vivo, 02/10/2026, corte posterior a09:10UTC. A sigue activo; aún no es la entrega final por agotamiento.** Un único manager debe dirigir. Esta versión reemplaza el estado operativo anterior, conservado en Git y LAUNCH-BOARD.md.

## Mandato y presupuesto vigentes

El titular autoriza dirigir, delegar, implementar y publicar mejoras comprobadas dentro del alcance. Pidió consumir trabajo útil de la cuota y entregar el relevo al0%. **No créditos para desarrollo**; sólo mínimo imprescindible para terminar el relevo si la cuota se agotó antes. Última lectura:85%usado/15%libre,62497.459246créditos intactos y1reset disponible. Se retiró la reserva histórica15%; A congela nuevos paquetes al97% para cerrar. No gastar artificialmente. get_usage_limits sólo lee; no hay control de reset accesible comprobado. Si sigue así, detener y el titular lo aplica. [Prompt copiable y revisado](NEXT-MANAGER-PROMPT.md).

## Publicación actual

- Master/Desktop: `695b6f6c2e57380c7faa2c9529b4301c67d4ba7e`, tree `96abf9550932539630a33954bf5ba29eb9bc34d9`. PR198 publicada; App36976848491/SQL36976848426SUCCESS, deployment `dpl_3ubJmTMohiV9rtd9G8AW4SZTAoKy` READY/exacto/ambos dominios. Releer remoto antes de actuar.
- PR196 permite cancelar suscripción pendiente con confirmación y preserva estado incierto. PR197 cerró la prueba real de CI sólo documental. PR198 recupera errores de consulta de horarios sin perder selección, con ocho casos. PR192–195 y anteriores siguen acreditadas; no repetir.
- No migración productiva nueva en este tramo. Desktop conserva archivos ajenos sin seguimiento. Landing PR191 aceptada: mantener estructura completa e identidad violeta; no otro rediseño.

## Paquetes actuales y primera acción

| Paquete | Estado y continuación exacta |
|---|---|
| PR199 seguridad de imágenes | B opera `sharp-security-patch/folio-app`, branch `codex/sharp-security-patch`. Head autorizado `9d126dd5da196779e16261664d679991655f4392`, tree `df31bec0300520ac4c37bde118ec12d0e28a7b5b`. Incluye sharp0.35.4, diagnóstico de descarga sanitizado y prueba de teclado. Revisión último delta10954ae4PASS, ocho casos locales; prueba de teclado y descarga ya PASS en nueva CI, resto App/build aún en curso. B tiene autorización persistente de squash/publicación sólo con todos los controles requeridos, identidad y readback. Reconciliar PR/run/deploy antes de otra acción. |
| Correo: autoridad del destinatario | D congeló `553860117a361dea4f6bb4959cd66d8daf116d94`, tree `167795a6cb41ba4214dda2e5f5d0a287796cb38e`, en `mail-recipient-authority/folio-app`. Cinco archivos lib/email y tests;58tests ficticios/tipos/lint y revisión3c4e9187PASS. A aceptó. Sin push/PR todavía. D comprueba brecha concreta de prueba integrada DB real/transporte falso antes de decidir si añade ensayo. No migraciones/envíos; usa email_finish y limpiezaM100 existentes. Carreras posteriores a lectura siguen posibles, no prometer atomicidad. Integrar después dePR199. |
| Google interno | R `f7e7f5fe5e308ca5ad9581a906c6d3cac0c482c2`, tree `ff2b714644deee448d492bbd920d19b17b74a5e3`, checkout `google-internal-proof/folio-app`. Run36981763537 único/PASS: cuatro casos, Supabase/Auth/RLS real efímero, Google HTTP loopback, cleanup; A31hashes/API/originales. Publicar R trasPR199 conservando10archivos y revisiónAC9B191C, nunca H operativo `cdbb75d18f3f672b47dc3054ed221491b9719fa3`. No repetir ensayo por cambios ajenos; Google real/UI/cron/webhook pendientes. |
| Compatibilidad y recuperación17.11 | Cerrado, no repetir. SQL36983198940/Hae0cd4cd:138migraciones/82specs/carreras,0SKIP. C01/Supabase36988027328/Hcaeab0d3, treeb0dac5ec:170011 en4fases, catálogos iguales, Auth/TOTP/RLS/ciphertext/Storage/autenticidad. A verificó API/originales/31hashes; READY277649ba. Los extremos usan17.11; no prueba pg_upgrade17.6→17.11 ni equivalencia managed. Producción sigue17.6; upgrade requiere backup/custodia y ventana autorizada. Wrappers sólo tags, nunca merge. |

PR199 conserva fallos anteriores: descarga intento1 instaladorSupabase(no prueba ejecutada), intento2 navegador sin diagnóstico recuperable; luego descargaPASS pero App falló foco. El probe local observó retry temporalmente disabled, sin reproducir el fallo histórico. El nuevo test espera enabled y usa Tab/Enter reales; no inventar causa histórica ni borrar intentos. Dos avisosHIGH de sharp eliminados en auditoría acotada,21→19; no declarar seguridad global ni repetir auditoría por rutina.

## Evidencia y equipo

Raíz de pruebas: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/`. Carpetas: `public-booking-readiness-20261002/`, `checkpoint-close-20261002/`, `dependency-readiness-20261002/`, `mail-readiness-20261002/`, `google-c05-readiness-20261002/`, `postgres-readiness-20261002/`. Los recibos nombran originales, hashes y límites. No confundir resultado simulado, aislado, publicado y proveedor real.

- B — Acceso y producto de Folio: `01a0bb34-d7b9-7841-b45c-1889b0b987dd`; operaciónPR199 activa.
- C — Continuidad y proveedores de Folio: `01a0bb34-d802-7852-82c5-126c0af7e654`; C01 cerrado, espera asignación de integraciónGoogle trasPR199.
- D — Experiencia y verificación de Folio: `01a0bb34-d7b9-7841-b45c-189d01589d14`; fixcorreo congelado, investigación integrada acotada.
- Folio — Legal, privacidad, SEO y rendimiento: `01a0dfc7-8b7d-73f1-9321-2ce5d9a59371`; consulta contractual preparada, no enviada.
- Hijos actuales booking_recovery_review/checkpoint_docs_review/mail_authority_review: revisiones terminadas. Otro chat puede necesitar nuevos agentes; conservar pruebas existentes. Sol6.1High para implementación/revisión; Medium para operaciones acotadas. Máximo2escritores aislados; A mantiene docs y acepta, no rehace implementación.

## Decisiones externas y límites

**H3 abierto:** titular respondió «Todavía no» sobre cobertura contractual de Vercel para datos de salud. PR188/M147 retenida, incorporaciónM148–M150/UI y piloto clínico real también. No confundir pruebas aprobadas con permiso contractual. M144 ya aplicada; no retenida ni reaplicar.

La consulta `provider-question-20261001/CONSULTA-VERCEL.md` está preparada; autorización de envío preguntada, sin respuesta afirmativa. Decisión adicionalClínica por profesionales o todos los integrantes preguntada, sin resolver. No repetir preguntas ni decidir por inferencia. EnsayoGoogle real requiere cuenta/calendario y autorización específica de eventos ficticios. Correo/pagos reales, custodia externa, identidad/preaviso legal y validación de cinco especialidades conservan requisitos propios. No compras, cargos ni mensajes como atajo.

Piloto acordado:3profesionales/14días/almenos5jornadas cadauno, sin problemas graves. La cuota no sustituye tiempo humano. Adultos/pacientes nuevos; menores, WhatsApp automático, agentes operativos y trasladoCoofit después.

AVANCES.md y su copia en branch `codex/launch-checkpoints` son el artefacto activo. Panel4420 detenido; aprobación automática rechazó reinicio sin motivo específico, no eludir. Automatización horariaPAUSED. No Docker local, secretos, env overwrite, destrucción o limpieza de evidencia. M106/M120/M121/M144/M145/M146 aplicadas e inmutables. ParUpstashreparado se preserva.

**Al cierre:** actualizar publicación exacta, cuota/créditos, PRs/runs/owners, bloquear nuevos encargos antes del0% y entregar prompt. No abrir un manager paralelo antes de finalizar este relevo. Si el reset no tiene control accesible, detener y dejarlo al titular.
