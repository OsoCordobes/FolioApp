# Folio · relevo del manager

**Borrador vivo, 02/10/2026, corte posterior a09:10UTC. A sigue activo; aún no es la entrega final por agotamiento.** Un único manager debe dirigir. Esta versión reemplaza el estado operativo anterior, conservado en Git y LAUNCH-BOARD.md.

## Mandato y presupuesto vigentes

El titular autoriza dirigir, delegar, implementar y publicar mejoras comprobadas dentro del alcance. Pidió consumir trabajo útil de la cuota y entregar el relevo al0%. **No créditos para desarrollo**; sólo mínimo imprescindible para terminar el relevo si la cuota se agotó antes. Última lectura:87%usado/13%libre,62497.459246créditos intactos y1reset disponible. Se retiró la reserva histórica15%; A congela nuevos paquetes al97% para cerrar. No gastar artificialmente. get_usage_limits sólo lee; no hay control de reset accesible comprobado. Si sigue así, detener y el titular lo aplica. [Prompt copiable y revisado](NEXT-MANAGER-PROMPT.md).

## Publicación actual

- Master/Desktop: `ee503a4149391a8959b6a1698a43041973b3fc55`, tree `075e9d0de21832371632d7c5865785e0953074b6`. PR200 publicada; App36991694742/SQL36991694656SUCCESS, deployment `dpl_dy69fW1tp8JM8jEMFqrPYyDKGMrj` READY/exacto/ambos dominios. READYba625431 y73hashes contrastados por A. Releer remoto antes de actuar.
- PR196 permite cancelar suscripción pendiente con confirmación y preserva estado incierto. PR197 cerró la prueba real de CI sólo documental. PR198 recupera errores de consulta de horarios sin perder selección, con ocho casos. PR192–195 y anteriores siguen acreditadas; no repetir.
- No migración productiva nueva en este tramo. Desktop conserva archivos ajenos sin seguimiento. Landing PR191 aceptada: mantener estructura completa e identidad violeta; no otro rediseño.

## Paquetes actuales y primera acción

**Corte vigente:** PR199 y PR200 cerradas y publicadas. C integra correo para un único ensayo aislado antes de publicarlo. B prepara el recorrido completo desde miniweb; su primer módulo tiene un P2 de correlación en Hoy ya corregido localmente, hijo/revisión aún pendientes. D terminó implementación y mantiene su copia congelada. Los detalles siguientes son de este corte, no permisos para repetir operaciones.

| Paquete | Estado y continuación exacta |
|---|---|
| PR199 seguridad de imágenes | Cerrada: squash bd6128a9/tree df31bec0, candidato9d126dd, siete archivos. PR/master CI,12 casos sharp Linux, teclado y descarga aprobados; deployment dpl_4TrKWFvFPi77trzbCeadG3hwL9U7 exacto/READY y6GET. FINAL78f582a0,40hashes comprobados. No repetir ni reabrir el paquete. |
| Correo: autoridad del destinatario | Producto55386011/tree167795a6 en mail-recipient-authority, cinco blobs revisados y58tests ficticios. ArmazónQ0cb251f retenido por proyecto ausente en bridge; hijo6489994269297e251b309640e572a01ed5be2a51/tree3a50c4094a5e9f2caf1056eea88eb7baaef247be cierra P2, revisiónba59b944. C integra once archivos sobre masteree503 en copia propia; freeze operativo pendiente. Workflow372975762 registrado/activo. Único dispatch de ref/tag revisado, candidate_sha exacto/proof_mode=mail-internal antes del squash; si input rechazado conservar respuesta y volver a A, sin workaround. Cero ensayos mail ejecutados todavía. |
| Google interno | Cerrado e integrado porPR200/e6b0aeb5→ee503a41. Rf7e7f5fe y diez blobs preservados; run36981763537 con cuatro casos reales de backend/Google loopback,31hashes/API y cleanup aceptados. Ensayo reutilizado sin otro dispatch. Workflow manual disponible. Hcdbb75d1 nunca integrar. Google externo/UI/cron/webhook no acreditados; nuevo paquete B cubre sólo el puente UI. |
| Puente de reserva pública | B: public-booking-joined-proof/folio-app, módulo547f6abf1da50d9b74d32170912f5d4b614b12f1/tree96625db9; sólo3archivos propios. Revisión3894510d retiene por Hoy sin comprobar destino paciente durable; corrección local añade URL exacta/hoyPatientLink y6focalesPASS, falta hijo/review. Adaptador aún no implementado: ownership runner/bridge sigue separado, no tocar hasta transferencia. Requiere Next y navegador realmente aislados, cookies AAL2 privadas, un pedido con aceptación manual/Agenda/Hoy/intent/evento loopback, sin proveedor real. No runtime ejecutado ni publicado. |
| Compatibilidad y recuperación17.11 | Cerrado, no repetir. SQL36983198940/Hae0cd4cd:138migraciones/82specs/carreras,0SKIP. C01/Supabase36988027328/Hcaeab0d3, treeb0dac5ec:170011 en4fases, catálogos iguales, Auth/TOTP/RLS/ciphertext/Storage/autenticidad. A verificó API/originales/31hashes; READY277649ba. Los extremos usan17.11; no prueba pg_upgrade17.6→17.11 ni equivalencia managed. Producción sigue17.6; upgrade requiere backup/custodia y ventana autorizada. Wrappers sólo tags, nunca merge. |

PR199 conserva fallos anteriores: descarga intento1 instaladorSupabase(no prueba ejecutada), intento2 navegador sin diagnóstico recuperable; luego descargaPASS pero App falló foco. El probe local observó retry temporalmente disabled, sin reproducir el fallo histórico. El nuevo test espera enabled y usa Tab/Enter reales; no inventar causa histórica ni borrar intentos. Dos avisosHIGH de sharp eliminados en auditoría acotada,21→19; no declarar seguridad global ni repetir auditoría por rutina.

## Evidencia y equipo

Raíz de pruebas: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/`. Carpetas: `public-booking-readiness-20261002/`, `checkpoint-close-20261002/`, `dependency-readiness-20261002/`, `mail-readiness-20261002/`, `google-c05-readiness-20261002/`, `postgres-readiness-20261002/`. Los recibos nombran originales, hashes y límites. No confundir resultado simulado, aislado, publicado y proveedor real.

- B — Acceso y producto de Folio: `01a0bb34-d7b9-7841-b45c-1889b0b987dd`; PR199 cerrada, módulo joined en corrección/revisión. No ownership compartido aún.
- C — Continuidad y proveedores de Folio: `01a0bb34-d802-7852-82c5-126c0af7e654`; PR200 cerrada, integra correo en copia de release propia y prepara contrato del único ensayo.
- D — Experiencia y verificación de Folio: `01a0bb34-d7b9-7841-b45c-189d01589d14`; implementación correo6489994 terminada/congelada, C asume operación. No nuevos trabajos.
- Folio — Legal, privacidad, SEO y rendimiento: `01a0dfc7-8b7d-73f1-9321-2ce5d9a59371`; consulta contractual preparada, no enviada.
- Hijos actuales booking_recovery_review/checkpoint_docs_review/mail_authority_review: revisiones terminadas. Otro chat puede necesitar nuevos agentes; conservar pruebas existentes. Sol6.1High para implementación/revisión; Medium para operaciones acotadas. Máximo2escritores aislados; A mantiene docs y acepta, no rehace implementación.

## Decisiones externas y límites

**H3 abierto:** titular respondió «Todavía no» sobre cobertura contractual de Vercel para datos de salud. PR188/M147 retenida, incorporaciónM148–M150/UI y piloto clínico real también. No confundir pruebas aprobadas con permiso contractual. M144 ya aplicada; no retenida ni reaplicar.

La consulta `provider-question-20261001/CONSULTA-VERCEL.md` está preparada; autorización de envío preguntada, sin respuesta afirmativa. Decisión adicionalClínica por profesionales o todos los integrantes preguntada, sin resolver. No repetir preguntas ni decidir por inferencia. EnsayoGoogle real requiere cuenta/calendario y autorización específica de eventos ficticios. Correo/pagos reales, custodia externa, identidad/preaviso legal y validación de cinco especialidades conservan requisitos propios. No compras, cargos ni mensajes como atajo.

Piloto acordado:3profesionales/14días/almenos5jornadas cadauno, sin problemas graves. La cuota no sustituye tiempo humano. Adultos/pacientes nuevos; menores, WhatsApp automático, agentes operativos y trasladoCoofit después.

AVANCES.md y su copia en branch `codex/launch-checkpoints` son el artefacto activo. Panel4420 detenido; aprobación automática rechazó reinicio sin motivo específico, no eludir. Automatización horariaPAUSED. No Docker local, secretos, env overwrite, destrucción o limpieza de evidencia. M106/M120/M121/M144/M145/M146 aplicadas e inmutables. ParUpstashreparado se preserva.

**Al cierre:** actualizar publicación exacta, cuota/créditos, PRs/runs/owners, bloquear nuevos encargos antes del0% y entregar prompt. No abrir un manager paralelo antes de finalizar este relevo. Si el reset no tiene control accesible, detener y dejarlo al titular.
