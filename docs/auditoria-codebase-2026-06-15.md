# Folio — Reporte de QA consolidado (post PRs #57–#62, M56–M60 + logout)

**Fecha:** 2026-06-15 · **Branch:** master · **Lead QA:** consolidación de 7 lentes (Hoy, Calendario, Pacientes, Ficha+especialidades, Config/Onboarding/Booking, Correctness/Integridad, Seguridad-PHI/A11y) + checks.

Todos los hallazgos load-bearing fueron re-leídos en código y adjudicados. Se dedupearon los que aparecían en varias lentes (el bug de edad CV y el de keyboard del spine-map venían por duplicado).

---

## 1. Resumen ejecutivo + conteo por severidad

La base está sólida para la demo. **No hay blockers.** Los stubs son honestos (disabled + tooltip), los flujos centrales funcionan y la capa de datos/migraciones M56–M60 está bien cableada (cifrado PHI, upserts 1:1, erasure, vistas `security_invoker`). Lo que conviene tocar antes de demostrar son 2 HIGH de UX/a11y y 3 MEDIUM (uno clínico, uno de PHI, uno de no-op destructivo).

| Severidad | Cantidad |
|---|---|
| 🔴 Blocker | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 3 |
| 🔵 Low | 11 |
| ⚪ Nit | 9 |

**Estado de checks:** `typecheck` ✅ limpio · `lint` ✅ 0 errores (2 warnings en `video-build/`) · `test:unit` ✅ 482/482 · `build` no corrido (falla por env del sandbox, no por código).

---

## 2. Hallazgos priorizados (blocker → nit)

### 🟠 HIGH

#### H1 · Configuración → Cuenta: editar **Email** es un no-op que confirma "Todo guardado" sobre un cambio descartado
- **Dónde:** `components/configuracion/configuracion.tsx:209-211` (input editable, marca dirty) → `:1559-1571` (`handleSave` arma el payload de `saveConsultorioAction` SIN `email`) · `lib/db/configuracion.ts:247-309` (`saveConsultorio`/schema no aceptan ni escriben `email`).
- **Detalle:** El input bindea `onChange → set({email})`, habilita "Guardar cambios", muestra "Guardando…" y luego "Todo guardado", pero `email` nunca viaja al action ni se persiste. Al recargar vuelve el valor viejo. `profile.email` SÍ es columna real (se lee en `getConfiguracionData` y en `/configuracion/datos`). Estado engañoso: confirma éxito sobre un cambio perdido.
- **Fix:** Camino rápido para demo → hacer el input `readOnly`/`disabled` con copy "el email de login se gestiona aparte" (no debe marcar dirty). Camino completo → agregar `email` al schema/payload + actualizar `profile.email` y `auth.users` vía `supabase.auth.updateUser` con re-verificación (cambiar el email de login toca Supabase Auth, no solo `profile`).

#### H2 · Mapa vertebral de quiropraxia v2 no es operable por teclado (WCAG 2.1.1)
- **Dónde:** `lib/especialidades/quiropraxia/spine-map.tsx:218-226` (vista posterior) y `:420-428` (vista lateral).
- **Detalle:** Cada vértebra es `<g role="button" aria-label=…>` con `onClick` pero **sin `tabIndex` ni `onKeyDown`**. Un `<g>` SVG no es focuseable por defecto, así que `role="button"` sin `tabIndex={0}` no recibe foco ni se activa con Enter/Space. Toda la carga de técnica de ajuste por vértebra —la superficie principal del tool de quiro v2— queda solo con mouse/táctil. El toggle de vista, el panel y el resto del tool sí son accesibles; solo el selector de vértebra queda fuera.
- **Fix:** Agregar `tabIndex={0}` + `onKeyDown` que dispare `onPick(v.id)` en Enter/Space (con `e.preventDefault()` en Space) a los `<g>` de ambas vistas. Idealmente mover foco al panel al seleccionar y devolverlo al cerrar; verificar outline de foco visible sobre el glifo.

---

### 🟡 MEDIUM

#### M1 · El score de riesgo CV ignora la edad (subestima a pacientes ≥60)
- **Dónde:** `lib/especialidades/cardiologia/tool.tsx:359` (`scoreRiesgoCV(factores)` sin 2º arg) · `lib/especialidades/cardiologia/schema.ts:264` (`resumenSesionCardiologia`, mismo problema) · contrato `lib/especialidades/types.ts:29-56` (`SpecialtyToolProps` no expone `edad`) · función `lib/especialidades/cardiologia/schema.ts:150-165`.
- **Detalle:** `scoreRiesgoCV(factores, edad?)` suma +1 si `edad>=60` (regla documentada y **testeada** en `tests/unit/cardiologia-schema.test.ts:140-150`). El chip vivo lo llama sin `edad`, y `SpecialtyToolProps` ni siquiera tiene el campo, aunque `paciente.edad` está disponible en `TabPlan` vía `usePacienteFicha`. Resultado: el parámetro `edad` es código muerto en prod; un paciente de 70 con tabaquismo+diabetes+HTA muestra "moderado" cuando con la regla declarada sería "alto". No es diagnóstico (etiqueta "orientativo"), por eso medium y no high, pero es un mismatch real entre la lógica testeada y lo que ve el médico. (Coincide con el bug ya marcado como ALTA en `docs/especialidades-research-2026-06-14.md`.)
- **Fix:** Agregar `edad?: number` a `SpecialtyToolProps`, pasarlo desde `TabPlan` (`paciente-detalle.tsx`, ya tiene `paciente.edad`) y usarlo en `tool.tsx:359` → `scoreRiesgoCV(factores, edad)`. Es aditivo (quiro/psico lo ignoran). El resumen histórico en `schema.ts:264` no tiene edad por sesión: dejarlo sin edad o documentar la divergencia; lo crítico es el chip vivo.

#### M2 · Menú ⋮ ofrece "Cancelar" en turnos **ATENDIENDO**: no-op silencioso tras un confirm destructivo
- **Dónde:** `components/hoy/turno-row.tsx:108-113` (`puedeCancelar` por exclusión) y `:322-338` (ítem) → `dashboard.tsx:79-107` (`handleTransition`) → `lib/turno-states.ts:54-55` (`en_sala/atendiendo` no permiten `cancelado`).
- **Detalle:** `puedeCancelar` se calcula por exclusión (true para agendado/confirmado/en_sala **y atendiendo**), pero la matriz no permite `atendiendo→cancelado` (`VALID_TRANSITIONS.atendiendo = ["cerrado"]`, igual en DB M09/M57). En un turno en curso el ⋮ muestra solo "Cancelar"; al confirmar el `window.confirm` destructivo, `applyTransition` detecta transición inválida, `handleTransition` ve `next===before` y NO dispara la server action. Sin error inline, sin cambio de estado: solo un `console.warn` invisible. Estado alcanzable real (al apretar "Abrir ficha" el turno pasa a atendiendo con la fila visible).
- **Fix:** Alinear `puedeCancelar = canTransition(turno.estado, "cancelado")` (importar `canTransition` de `lib/turno-states.ts`). Así el ítem desaparece en `atendiendo` y `tieneMenu` pasa a false para ese estado. Sumar un test de la matriz cliente (hoy solo se testea el lado DB).

#### M3 · El motivo de consulta del booking (PHI) se filtra a recepción vía el pedido pendiente, contradiciendo el gate de M56
- **Dónde:** `lib/db/calendario.ts:362` (`const motivo = tryDecrypt(row.motivo_cifrado…)` sin gate) vs el gate correcto en `:344-346` y `:774-776` (`notaReserva` solo si `canReadClinical`) · RLS `pedido_select_admin` en `supabase/migrations/…M09…:532`.
- **Detalle:** M56 traza que el motivo del booking es PHI clinic-only (`notaReserva` fail-closed sin sesión clínica). Pero mientras el pedido sigue PENDIENTE, el MISMO texto se descifra **sin gate** en `calendario.ts:362` y viaja al cliente en el objeto `Pedido`, que `PedidoModal` renderiza. La RLS del pedido solo exige pertenecer a la org (no `can_read_clinical`), así que ASISTENTE/COORDINADOR ven el motivo. Es preexistente, pero M56 deja la inconsistencia a la vista: clinic-only en el turno, abierto en el pedido.
- **Fix:** Espejar el gate de M56 en el reader de pedidos: descifrar `pedido.motivo` solo cuando `canReadClinical` (sino `""`/`null`), o decidir explícitamente que el motivo del pedido es admin-visible y documentarlo. Si es PHI estricta, acotar columnas en la lectura/policy para recepción.

---

### 🔵 LOW

| # | Título | Dónde | Fix |
|---|---|---|---|
| L1 | Login rechaza client-side passwords <8 chars, anulando la decisión del server (passwords legacy) | `components/auth/login-form.tsx:129-132` vs `app/(public)/login/actions.ts:32-38` | Quitar la regla de longitud mínima del form de **Login** (dejar solo "ingresá tu contraseña"); conservar el min(8) en **Signup** (`:331`). |
| L2 | Plan: "Gestionar suscripción" / "Ver historial" hacen 404 para DIRECTOR/PROFESIONAL aunque ven la sección | `components/configuracion/configuracion.tsx:1385-1399` · `app/(app)/configuracion/billing/page.tsx:44-45` (`notFound()` si ≠ OWNER) | Gatear `SecPlan` (o solo sus CTAs) por `isOwner`, o copy "solo el titular gestiona la suscripción" en vez de un link que 404ea. |
| L3 | `emitirFacturaAction` (AFIP) implementada pero sin ningún disparador en la UI de Finanzas | `app/(app)/finanzas/actions.ts:20-39` (único uso = su definición) | Confirmar si la facturación se dispara desde otra vista (cierre/detalle de turno) o agregar botón en la fila PAGADA; si quedó fuera de scope, documentarlo. |
| L4 | WhatsApp masivo no antepone código de país (54) — números AR locales abren `wa.me` inválido | `components/pacientes/pacientes-dir.tsx:563-580` (`handleBulkWhatsApp`) | Normalizar a E.164 AR (anteponer 54, quitar 0 inicial y 15) antes de armar el link; reusar un helper común si existe. Afecta la acción "reactivar". |
| L5 | DNI 1–4 dígitos: mismatch de validación (action sin min, db con min(5)) → error genérico sin guía de campo | `app/(app)/pacientes/actions.ts:50` vs `lib/db/pacientes.ts:31` | Alinear el min: agregar `min(5)` (cuando no esté vacío) al schema de la action para mensaje específico de DNI, o relajar el min en `createPacienteSchema`. Validar largo en cliente. No crea fila huérfana. |
| L6 | COORDINADOR en la allowlist de la ficha produce 404 en vez de redirect limpio | `app/(app)/pacientes/[id]/page.tsx:31-41` | Quitar COORDINADOR de `ROLES_PUEDEN_VER_PHI` (que caiga al redirect a `/pacientes`) o mostrar mensaje explícito. No hay fuga PHI (RLS aguanta); es UX. |
| L7 | Carry-forward de quiropraxia puede no persistirse aunque la UI muestre las vértebras sembradas | `lib/especialidades/quiropraxia/tool.tsx:78-96` | No es bug de cableado (igual que cualquier borrador: hay que apretar Guardar). Considerar indicador "sembrado de la visita del {fecha} — guardá para conservar". Verificar el flujo en demo. |
| L8 | Cardio: con vitales fuera de rango "Guardar sesión" no se deshabilita; el rechazo recién aparece al guardar | `lib/especialidades/cardiologia/tool.tsx:351-354,426-437` + `paciente-detalle.tsx:384-395` | Exponer validez del borrador para deshabilitar el botón, o mapear el error de `toolData` a un mensaje específico. No persiste dato corrupto (se aborta antes de cifrar). |
| L9 | Pedidos REAGENDADO se fetchean pero nunca se muestran en ninguna vista del Calendario | `lib/db/calendario.ts:298` vs `calendario.tsx:703,631,992` (UI filtra `=== 'pendiente'`) | Decidir destino: no traerlos (`.in()` solo `PENDIENTE`) o incluirlos en la Bandeja para que sean accionables. Hoy se descifra PII de filas que no se renderizan. |
| L10 | Mismatch tray "sin asignar" vs Bandeja: el conteo del trigger no coincide con lo que abre | `components/calendario/calendario.tsx:395-411,631,1040-1043` | Alinear: que el tray cuente/abra solo los sin-fecha, o ajustar el copy para reflejar que la Bandeja muestra todos los pendientes. |
| L11 | Navegación a la ficha durante "Abrir ficha" puede perder el `revalidatePath('/hoy')` del refresh | `components/hoy/turno-row.tsx:67-73` + `dashboard.tsx:92-103,183-189` | Aceptable: el polling de 25s reconcilia. Si se quiere garantía, navegar on-success. No requiere acción para la demo. |

### ⚪ NIT

| # | Título | Dónde |
|---|---|---|
| N1 | Stubs "Próximamente" permanentes (Editar contacto, Nueva sesión, Ver detalle, Subir documento) — honestos, no engañosos; contrastan con que radiografías de quiro SÍ sube | `components/paciente/paciente-detalle.tsx:434-441,556-564,588-595,616-624` |
| N2 | Navegación a la ficha usa `window.location.href` (full reload) en vez de `router.push` | `components/pacientes/pacientes-dir.tsx:521,546` |
| N3 | Resume de onboarding no restaura `slotMin` (cae al default 45) — limitación de modelo, no rotura | `lib/db/onboarding-resume.ts:209,274` |
| N4 | Docstring de `ESTADOS_REAGENDABLES` desactualizado tras M57 (falta `AGENDADO → EN_SALA`) | `lib/db/turnos.ts:511-524` |
| N5 | Docblock de cabecera de Calendario declara VistaBandeja/VistaMes/modales como "placeholder/diferidos" (ya implementados) | `components/calendario/calendario.tsx:11-16` |
| N6 | Línea "ahora" puede dibujarse fuera de grilla si la hora local cae fuera de 08:00–19:00 (cosmético) | `components/calendario/calendario.tsx:50-53,777-781` |
| N7 | Menú ⋮ de turno: sin navegación por flechas ni foco inicial al ítem (cumple lo esencial WAI-ARIA) | `components/hoy/turno-row.tsx:286-339` |
| N8 | Input de nota de radiografía solo con placeholder (sin accessible name) | `lib/especialidades/quiropraxia/radiografias.tsx:157-165` |
| N9 | 2 warnings de lint (`'e' unused` en catch) en `video-build/record.mjs:30,36` — tooling, no runtime | `video-build/record.mjs:30,36` |

---

## 3. Matriz de smoke test por área

Estados: **ok** · **disabled_stub** (deshabilitado honesto, "Próximamente") · **no_op** (parece accionable pero no hace nada) · **roto** (falla funcional/a11y) · **sospechoso** (cableado con un mismatch lógico).

### Hoy / cola del día (`/hoy`)
| Tab/Botón | Estado | Nota |
|---|---|---|
| Imprimir / Turno walk-in (header) / FAB Walk-in | ok | `window.print()` y `setWalkInOpen` reales |
| ProfFilterChips (modo clínica) | ok | `/hoy?prof=<id>`, solo >1 colegiado |
| Marcar llegada / Abrir ficha / Cerrar turno (CTAs por estado) | ok | Transiciones alineadas con M57 |
| Menú ⋮ → Reagendar / No asistió | ok | Gating correcto, transiciones válidas |
| **Menú ⋮ → Cancelar (en turno ATENDIENDO)** | **no_op** | **M2: confirm destructivo sin efecto** |
| Toggles Cerrados / Cancelados / fila → ficha | ok | |
| TurnoCreateModal (Existente/Nuevo, pickers, submit) | ok | Columnas coinciden con M09 |
| TurnoReagendarModal (submit) | ok | |
| GcalNudgeBanner (Conectar / Dismiss) | ok | |
| Drag handle de fila | disabled_stub | Solo visual (aria-hidden), F4 no implementado |

### Calendario
| Tab/Botón | Estado | Nota |
|---|---|---|
| Tabs Semana / Mes / Bandeja (badge) | ok | Client state, badge real |
| Nav semana/mes (anterior/Hoy/siguiente) | ok | SSR `?w=`/`?mes=`, preserva `&prof=` |
| Chips filtro estado / chip Pedidos | ok | Toggle sobre Set, keys reales |
| Selector profesional / botón Agendar | ok | |
| Cards turno (semana/mes) → detalle | ok | Teclado Enter/Space |
| Card pedido fantasma / tray / filas Bandeja | ok | |
| TurnoDetalleModal (Cerrar / Ver ficha) | ok | a11y modal correcta |
| PedidoModal (Aceptar / Rechazar / picker prof) | ok | Valida fecha, motivo ≥5 chars |
| Auto-refresh agenda (polling 25s) | ok | Guard de visibilidad |
| Pedidos REAGENDADO en cualquier vista | roto (dato inalcanzable) | L9: se fetchean, nunca se muestran |

### Pacientes (directorio + alta + intake)
| Tab/Botón | Estado | Nota |
|---|---|---|
| Buscador (client-side) / tabs filtro / Nuevo paciente | ok | El badge "/" es decorativo (sin handler) |
| Fila → ficha / checkboxes / Agendar inline | ok | Navegación dura (`window.location`) |
| Exportar CSV | ok | |
| BulkBar · Enviar WhatsApp | ok | L4: sin prefijo país en números locales |
| BulkBar · Etiquetar / Archivar | disabled_stub | "Próximamente", nunca disparan |
| BulkBar · limpiar selección / ReactivarWidget | ok | |
| PacienteCreateModal (campos, submit, avanzado, especialidad clínica) | ok | L5: DNI 1–4 dígitos da error genérico |
| IntakeAvanzadoFields (campos dinámicos) | ok | Server revalida contra schema |

### Ficha + especialidades (quiro v2 / cardio / psico)
| Tab/Botón | Estado | Nota |
|---|---|---|
| Tabs Información/Plan/Sesiones/Documentos | ok | WAI-ARIA + roving tabindex |
| WhatsApp / Sacar turno (header) | ok | |
| Editar plan + PlanTratamientoModal (submit) | ok | Upsert M58 |
| Información avanzada Editar + IntakeAvanzadoModal | ok | Upsert M60 |
| Guardar sesión / Guardar y cerrar (tab Plan) | ok | Deriva tool_id, cifra, transiciona |
| Información→Editar contacto / Sesiones→Nueva·Ver detalle / Documentos→Subir | disabled_stub | N1: stubs honestos; Documentos genérico no usa Storage (quiro sí) |
| Quiro · toggle vista / panel técnica / canvas / leg-check / visitas | ok | |
| **Quiro · click vértebra (selector del mapa)** | **roto (a11y)** | **H2: no operable por teclado** |
| Quiro · subir radiografía / refresh thumbnail | ok | |
| Quiro · carry-forward última visita | sospechoso | L7: sembrado en memoria, no persiste hasta Guardar |
| **Cardio · chip de riesgo CV** | **sospechoso** | **M1: ignora la edad** |
| Cardio · vitales / agregar estudio / ver todos | ok | L8: botón Guardar no se deshabilita con vitales fuera de rango |
| Psico · escalas PHQ-9/GAD-7 / estado mental / objetivos | ok | |

### Config / Onboarding / Booking
| Tab/Botón | Estado | Nota |
|---|---|---|
| Sidebar (nav / ver sitio / **Cerrar sesión → landing /** / GCal badge / ⌘K) | ok | Logout cumple → `/` |
| Login · Entrar | sospechoso | L1: bloquea passwords <8 client-side (server las permite) |
| Login · Google / Forgot / switches · Signup | ok | |
| Onboarding · Step1 / especialidad única / tipo org / autosave / Step6 servicios / Step7 Google / Step9 finalizar | ok | Fix de autosave del Paso 6 vigente |
| Config · SideNav (7 secciones) | ok | |
| **Config · Cuenta · Email** | **no_op** | **H1: dice "Todo guardado" pero descarta el cambio** |
| Config · Cuenta · Cambiar contraseña / Abrir mis datos | ok | |
| Config · Cuenta · Activar MFA / Consultorio · Subir imagen | disabled_stub | "Próximamente" |
| Config · Consultorio (especialidad / link público copiar) | ok | Usa `organization.slug` real |
| Config · Reservas web / Horarios / Servicios | ok | save-bar real |
| Config · Integraciones · Google (conectar/desconectar) | ok | |
| Config · Integraciones · Mercado Pago / WhatsApp | disabled_stub | "Disponible próximamente" |
| Config · Equipo (invitar/revocar/baja) | ok | |
| **Config · Plan · Gestionar suscripción / historial** | **sospechoso** | **L2: 404 para DIRECTOR/PROFESIONAL** |
| Finanzas · período / buscar / Exportar CSV | ok | |
| **Finanzas · emitir factura (AFIP)** | **no_op (huérfano)** | **L3: action completa, sin botón en la UI** |
| Booking público · wizard (servicio→[prof]→slot→datos→ok) | ok | Turnstile, consent, rate-limit, re-check slot |

---

## 4. Resultado de los checks

| Check | Resultado | Detalle |
|---|---|---|
| `pnpm typecheck` (`tsc --noEmit`) | ✅ PASS | Sin errores. ⚠️ El cliente Supabase está tipado `<any>` → tsc NO valida columnas/tablas/RPC; el esquema M56–M60 se verificó a mano contra `supabase/migrations/`. |
| `pnpm lint` (eslint) | ✅ PASS (0 errores) | 2 warnings `@typescript-eslint/no-unused-vars` (`'e'` en catch) en `video-build/record.mjs:30,36` — tooling del pipeline de video, no runtime, preexistente (N9). |
| `pnpm test:unit` (`node:test`) | ✅ PASS | 482/482 (incluye gates de billing, `verifyBearer`, crypto, overlap de turnos, matriz de estados DB). |
| `pnpm build` (`next build`) | ⏭️ no corrido | Falla por env del sandbox, no por código (según instrucción del agente de checks). |

**Recomendación de cierre:** ninguno de los hallazgos bloquea la demo. Antes de demostrar, priorizar **H1** (email no-op, fix de 1 línea haciéndolo readOnly) y **H2** (keyboard del spine-map, ~4 líneas) por ser de cara al usuario; **M1** (edad CV) si se va a mostrar el panel cardiológico; y **M3** (PHI del pedido) si en la demo participa un usuario con rol de recepción.