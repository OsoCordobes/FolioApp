# Folio — tablero único de lanzamiento

Actualizado: 29/09/2026, 21:08 UTC. Esta página es el estado operativo vigente. [AVANCES.md](AVANCES.md) es la vista breve del titular; panel http://127.0.0.1:4420/.

El historial anterior se conserva íntegro en [LAUNCH-BOARD-HISTORY-20260929-2050.md](LAUNCH-BOARD-HISTORY-20260929-2050.md), SHA256 f725a510211fce532871057d83063ad800f7ea419c1ebd537f2070fa93c767a0. Sus cortes fechados son antecedentes, no asignaciones actuales.

## Objetivo y reglas

Lanzar Solo y Clínica, cinco especialidades, Google y portal para adultos. Pacientes nuevos primero; menores, WhatsApp automático, agentes operativos y traslado histórico desde Coofit quedan después. Todos los checkpoints, incluido legal/privacidad/SEO/rendimiento, siguen en AVANCES; ningún paquete aislado acredita lanzamiento completo.

Priorizar riesgo, dependencias, utilidad y esfuerzo restante. Terminar, comprobar, entregar y tomar el siguiente paquete útil, sin semanas rígidas ni repetir pruebas por rutina. Piloto final: 14 días, tres profesionales, al menos cinco jornadas por persona y sin problemas graves pendientes. No inventar decisiones clínicas ni legales.

A dirige prioridades, presupuesto y aceptación; B coordina integración/publicación. Máximo dos escritores aislados, encargos con base, archivos propios, entorno, prueba y cierre. Revisiones independientes para cambios relevantes. Última lectura de cuota: 34% usada, 66% disponible; reserva15%. No atribuir consumo exacto a agentes.

La automatización folio-manager-por-checkpoints figura PAUSED; no se cambió esa preferencia. La ejecución actual continúa directamente. No esperar recordatorios ni prometer ejecución ininterrumpida.

## Estado y siguiente acción

| Área | Estado comprobado / próximo paso |
|---|---|
| B · Producto | PR188 candidato56a15725 con toda CI/revisión aprobadas, publicación retenida hasta copia nueva autenticada. M148 candidato8759fb6 completo en fuente/revisado, sin SQL ejecutado. Segundo escritor autorizado para preparar sólo la prueba autenticada S1 en checkout libre, sin tocar esos candidatos ni la previewL4. |
| C · Continuidad | Runtime PostgreSQL autocontenido y probe de ambas versiones PASS. D aprobó operador corregido; A autorizó21:08 exactamente un Update y un Start condicional. Resultado de instalación/captura todavía pendiente; conciliar antes de cualquier acción. |
| D · Calidad | Validó independientemente runtime y recibo del probe. Revisará sólo delta/plan de instalación y recibo de captura cuando existan. |
| Legal/SEO | S1/P1/L4 preparados, pruebas y revisiones cerradas. Preview4410 lista; publicación de P1/L4 retenida por preaviso de Privacidad§8 y decisiones del titular/asesoría. Sin escritor activo. |
| Diseño | El titular rechazó creativamente4387366d. A/B en4441 son propuestas de portada/demo, no versión final; sin publicación ni escritor activo. |

No abrir otro escritor que choque con C o con la reanudación de B. Si el titular pide trabajo directo en otro chat, sincronizar alcance/cupo y preservar sus decisiones.

## Publicación PR188 / M147

- PR: https://github.com/OsoCordobes/FolioApp/pull/188. Candidato exacto `56a15725dc6229a26368b26f8e58963a3252847e`, árbol `d74b5b6d40b5aac71fb813fb2705512f63e0bbc8`. App/Access/B06/B09/caller/recovery/SQL/Preview/Vercel PASS; B03 condicional SKIP. No repetir la CI ni atribuir a esos PASS la causa de fallos antiguos.
- Última lectura productiva29/09 19:21UTC: masterd567eb3, 138 migraciones hasta M146; M147 ausente. Preview139. Verificar estado fresco antes de actuar; NO repetir M144/M145/M146, PR165 smoke ni M106/M120/M121.
- Manifiesto revisado por D: `C:/Users/amiun/Documents/Codex/folio-b09-evidence/m147-publication-readiness-56a1572.json`, SHA256 `357559e882ec7cc56682cd3a2578efdae32f6a24cfd589d1e3af6782fb5fa594`. Operador `apply-b09-m147.mjs`, SHA256 `7316dbf1a930b090ab0e49fe14a16808022039d5248838ff723e1fc67345f6f3`; siete pruebas puras/pines/parseos PASS. Detalles de catálogo y hashes en el historial y el manifiesto.
- Orden: recibo de copia nueva autenticada → preflight fresco → revisar baseline menor a30min → aplicar M147 una vez → COMMIT confirmado y lectura durable → squashPR188 → verificar árbol/despliegue. Ante resultado incierto, inventario antes de cualquier reintento.
- La autonomía concedida por el titular permite publicar checkpoints comprobados. La condición adicional de copia nueva la fijó A ante respaldo vencido. --version o diagnóstico no la satisfacen. No incluir S1/P1/L4 ni M148 en PR188.

## Respaldo: hechos, artefactos y autorización

Raíz privada: `C:/Users/amiun/folio-recovery/initial-20260908-182017`. Principal Windows: `Folio - respaldo cifrado`. Usar Windows PowerShell5.1 para el operador. Última copia válida conocida19/09 15:27UTC; tres copias preservadas. El fallo precede al volcado. No hay copia nueva confirmada.

- R0: v5 quedó instalado correctamente, CAS `23351497cde6c9d30af02c2503fdb2d8138fbdabd967a30bef18c3b0a0669155`. CatchUp único falló `tool_version/tool_unavailable/not_found`, exit20. Recibo `r0-v5-catchup-result.json`, SHA256 `f29795364020e0edff35b384ddca400a77dfe5191c5add3f40da507a0038c0f9`. Sin reversión porque acción/metadatos coincidían; XML previo preservado.
- R1 causal: probe aislado con identidad/host/cwd/LocalAppData correctos vio Node, pero no la ruta exacta de pg_dump externo. No demuestra invisibilidad de todo FolioTools ni descarta loader. Primer registro temporal se detuvo antes de Start por contar null como trigger; se corrigió y probó null/vacío/uno. Todo el fracaso se conserva.
- Runtime definitivo: `backup-runtime-20260929T2034-r1-reviewed`, composición bytes v5 + único overlay capture-owned.mjs + bin PostgreSQL17.11 existente completo. Fuente `8429b3252062602f0d96a82ed62495f351e5732f`, siete pruebas focales PASS. Manifest `bc62e9aa29730c9328894e029df0917b611b5ae414998e3bd708d179adbb67b2`; launcher `ae0e3957afce3382a8f493fd594e7eae26aada18c75ab67d149fab14d5c7333e`. 233 archivos, PG68, inventario origen/destino exacto, cero reparse. v3/v4/v5 y candidato2032 sin uso preservados.
- Probe contained AUTORIZADO y YA EJECUTADO exactamente una vez: ambas herramientas17.11 visibles/legibles/hash correcto, --version exit0, sin DB/DPAPI/captura. Temporal eliminada y principal sin mutación. No repetirlo. Recibo `r1-contained-tool-probe-execute-v1.json`, SHA256 `31e131bf409fdf5aa008cd010c28f035ceb892100f9ebd0b4d3788d9b3d6501e`; resultado `9b21093d90805fa74cf6dcb844534ed3def0f3a44eefaa8cd97e64d217e105b5`; XML `8e6c34b456c16f4ed8fa583897c090f792832f4def21cc00692a244249b92eff`. D verificó independientemente.
- **AUTORIZADO21:08, resultado pendiente:** una invocación WindowsPowerShell5.1 de `C:/Users/amiun/Documents/Codex/folio-b09-evidence/r1-runtime-update-catchup-operator.ps1 -Mode Execute`, SHA256 `39008e815ec7c8fb155f44f46e635edc6e3a52708f6b582e0cd406423f06cf95`. Plan `bf9e8eebdfca5f98f992475e9883b32c5698a45cf16c5ccf9c547cd1c3b9cf84`, test `54779de7161a24071e97462e6da4ca65bad6b3147d7ee2b9d74c859ff5db9ac8`, cinco casos/AST y revisiónD PASS. Retención `494c8977e907c62faf69ef6d939efb2e8569d2085e23a177696356d503393204`: tres válidas + nueva hipotética, cero eliminaciones. Plan/Inspect/Status confirman compatibilidad manifestv2. Máximo un Update a runtime2034 y un Start condicional; XMLv5 preservado/UTF16 explícito, guard de evidencias/State/LastRun/CAS justo antes de Start. Reversiónv5 sólo ante discrepancia de acción/metadatos y no Running. Si automático inicia, reconciliar y Start0. La ejecución automática20:57:11 falló sobrev5, no fue provocada. No asumir éxito ni repetir tras interrupción.
- Condición de cierre: nueva copia cifrada autenticada, verificación enlazada, last-success nuevo, edad<24h, exit0 y preservación de copias/fallos. Custodia externa y recuperación de producción real siguen siendo gates separados.

## M148: incorporación administrativa

Checkout `C:/Users/amiun/.codex/worktrees/folio-miniweb-quality/folio-app`, rama codex/intake-incorporation. Candidato `8759fb6a3b8480d18cf7720054af9063d2e1d3e7`, árbol `8ff085cf1964ee62269e936be2178fe0a58e1264`, deriva de 56a mediante e9c0515/cb5860c. Limpio, sin push/DB/CI/apply.

Alcance: migración M148, spec SQL, runner de concurrencia, paso focal pgtap y `docs/B09-INCORPORATION-CONTRACT.md` de ese checkout. Revisión inicial detectó replay tras reasignación; corrección protege ambos caminos y pending/materialized antes de devolver fuente. A exigió mapa de cobertura: los nueve huecos (tenant/caja fuerte/recibo/payload/expiry/DOB/revocaciones factor-member-turno) quedaron cubiertos por casos ejecutables y revisión focal. También hay doble apply, respuesta perdida, cancelación, CAS/ABA, sesión y barreras de concurrencia.

Node check/lint/SQL estático/YAML/diff PASS. Esto es **cobertura en fuente, no SQL PASS**. Siguiente: después de PR188, sincronizar sin perder evidencia y ejecutar ensayo PostgreSQL16 hospedado revisado. Aplicaciones Preview también son inmutables: no editar migración aplicada. No habilitar interfaz ni incorporación con este estado; servidor/editores con revisión esperada y comparación UI son paquetes posteriores del contrato. Borradores preservados en `folio-manager-evidence/m148-draft-20260929-220658`.

## Legal, diseño y vistas para probar

- S1 indexación: `d122db0b1112b1e1b6c3fbe391e6819bf3ece651`, base d567, separado. Noindex de accesos/áreas privadas y login fuera de sitemap. Dos pruebas sintéticas, typecheck/lint/revisión PASS. Al integrar trasPR188, comprobar HTML autenticado de /hoy y /portal; no hay overrides descendientes conocidos, pero la prueba actual sólo acredita páginas públicas/redirecciones.
- S1 preparación siguiente21:05: B puede añadir comprobaciones robots de /hoy y /portal en fixtures existentes desde d122, aislado y sin conexión/DB/Docker/env/push/CI. Usar checkout libre; ae38 está ocupado por4410. No afirmar HTML autenticado probado a partir de mocks. Cierre de este paquete: pruebas preparadas/revisión y dependencia explícita del ensayo real; si requiere ámbito ajeno, informar en lugar de ampliar.
- P1 preferencias/mapa: `f8a0e5c2093f3130fc25ea1ef9fc0be36250e43f`; cinco e2e, cuatro unidades, móvil/escritorio/revisión PASS. Revocación/DNT/sincronía y mapa por acción; si almacenamiento no admite escritura/borrado, revocación dura sólo esa pestaña y se advierte. Sin proveedor real probado.
- L4: `8333569854702a33933034e2bce5cebb164582d3`, árbol `0f3f55cf32c6a24979f67bc47fec8f1dc6aba452`, padreP1. Dos writes onboarding registran PRIVACY_VERSION; M126 COALESCE conserva constancias previas. Seis blobs old/new verificados. Medición navegador/servidor explicadas por separado; exports etiquetan política vigente al generar, no aceptación histórica. Cuatro páginas/dos altas/tipos/lint y revisiónD PASS.
- Publicación legal RETENIDA: Privacidad§8 conserva aviso30d; no inventar envío ni eliminar obligación. Titular/asesoría deben resolver vigencia/aviso y datos responsables. Pregunta asíncrona enviada al titular sobre persona/empresa, país y asesoría; pendiente, no bloquea desarrollo independiente. [Propuesta](LEGAL-COPY-PROPOSAL.md) e [inventario](LAUNCH-LEGAL-SEO-PERFORMANCE.md) son borradores; su texto PostHog anterior se corrige en L4, no tratarlo como publicado.
- Preview L4: http://127.0.0.1:4410/cookies, /privacidad y /dev/book-preview?variant=map, HEAD8333569. HTTP200, versión2026-09-29, preferencias y cero iframes antes de acción. WrapperPID45384/Next46752/listener35088; `C:/Users/amiun/AppData/Local/Codex/folio-l4-preview/8333569-20260929/run.json`. Sin env editado, Docker/DB ni click Google.
- Diseño:4387366d está técnicamente comprobado pero rechazado creativamente por el titular. No publicarlo. Alternativas A/B en http://127.0.0.1:4441/ (PID42548), archivos/evidencia fuera del repo en `C:/Users/amiun/.codex/visualizations/2026/09/26/01a0df9c-b1cd-7682-b37b-f0d670f7516e/folio-directions/`. Checkout64d2 limpio en438; 4440/PID18556 conserva versión anterior. Falta valoración de A/B y desarrollo de página final; no repetir investigación10webs.

## Coordinación y límites de seguridad

| Chat | ID / ubicación |
|---|---|
| B — Acceso y producto de Folio | 01a0bb34-d7b9-7841-b45c-1889b0b987dd; integrador folio-adult-revocation, M148 folio-miniweb-quality |
| C — Continuidad y proveedores de Folio | 01a0bb34-d802-7852-82c5-126c0af7e654; ede1/folio-app |
| D — Experiencia y verificación de Folio | 01a0bb34-d7b9-7841-b45c-189d01589d14; f12d/folio-app |
| Folio — Landing premium en vivo | 01a0df9c-b1cd-7682-b37b-f0d670f7516e;64d2/folio-app |
| Folio — Legal, privacidad, SEO y rendimiento | 01a0dfc7-8b7d-73f1-9321-2ce5d9a59371;ae38/folio-app |

Seguir AGENTS y RTK.md; salidas nativas para decisiones consecuentes. No iniciar Docker, borrar bases/volúmenes/backups/fixtures/evidencia o archivos ajenos; no imprimir secretos ni sobrescribir env. Par Upstash reparado preservado; DPAPI depende de Windows. No activar correo, cargos, Google, compras ni política clínica por un permiso genérico o una entrada del tablero. Preparar acciones concretas y usar autorización vigente trazable. Comunicaciones globales siguen apagadas.

Recuperación sintética, proveedor real, legal, piloto y lanzamiento son gates distintos. [C](C-CONTINUIDAD-PROVEEDORES-SOPORTE.md) conserva el corte operativo inicial; los recibos posteriores de respaldo son los de esta página. [D](D-CALIDAD-PILOTO.md) define preparación de piloto, no aprobación profesional. [Auditoría de instrucciones](AGENT-SETUP-20260926.md): cerrada sin cambios necesarios, guía90/100 y Flow sin almacén; no repetirla.
