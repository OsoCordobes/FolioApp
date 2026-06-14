# Folio — Reporte accionable: fichas por especialidad + mejoras de plataforma

*Síntesis de la auditoría del código, la investigación de estándares clínicos reales y el benchmarking de top-tech. Fecha: 2026-06-14.*

---

## 1. Resumen ejecutivo

Folio tiene **tres fichas de especialidad ya en producción** (quiropraxia, cardiología, psicología) montadas sobre una arquitectura clínica de primer nivel: cifrado PHI app-side (AES-256-GCM por columna), schemas `zod .strict()` que **rechazan** payloads de otra herramienta en vez de corromperlos, RLS multi-tenant (`can_read_clinical()`), derivación server-side del `tool_id` según la **especialidad efectiva** del profesional del turno (M55), y un pipeline de insights con **benchmarking por cohorte geográfica** que casi nadie en el mercado AR tiene. Esto es defendible y vendible.

El patrón de **brecha clínica** es común a las tres fichas:

- **Capturan, pero no estandarizan ni puntúan según instrumentos validados.** Quiropraxia retiró todo scoring (vértebra binaria con/sin nota); cardiología tiene un score de riesgo que **no usa la edad** aunque está disponible (bug, `tool.tsx:359`); psicología tiene solo 2 de ~10 escalas habituales (PHQ-9/GAD-7).
- **Visualización de tendencia incompleta.** Cardio y psico tienen sparkline; quiro no grafica nada. Ninguna grafica los datos que el paciente completaría (outcome assessments).
- **El intake avanzado es genérico** (4-8 textareas libres por especialidad) y no se versiona ni enlaza con la sesión.

El **mayor ROI no está en las fichas sino en la operación de la agenda**: Folio hoy convierte cada cancelación en un hueco perdido. No hay **lista de espera** ni **recalls** (verificado: `lib/db/recordatorios.ts` solo crea 24h/2h/post-visita por turno), pese a tener ya **WhatsApp Cloud con templates aprobados**, cron dispatcher, MercadoPago integrado y disponibilidad calculada (`lib/booking/availability.ts`). Casi todas las palancas de retención e ingresos son extensiones de infra existente.

**Las 5 apuestas de mayor impacto** (detalle en §3-4):
1. **Seña anti-no-show por MercadoPago** + **confirmación interactiva WhatsApp** (Confirmar/Reagendar/Cancelar).
2. **Lista de espera + recalls por especialidad** (rellenar huecos + reactivar inactivos).
3. **Outcome assessments digitales con scoring + sparkline** en las tres fichas.
4. **Portal de pre-admisión** (extender `/book/[slug]`: intake + consentimiento + escalas antes del turno).
5. **Habilitantes de mercado**: receta electrónica (obligatoria AR) y AI scribe es-AR.

---

## 2. Por especialidad

### 2.1 Quiropraxia

**(a) Estado actual en Folio**
La ficha v2 (`quiropraxia.ficha.v2`) **reemplaza al SOAP** (`hideSoap===true`): ocupa el ancho completo. Layout en dos columnas — mapa vertebral SVG (posterior/lateral) a la izquierda, evaluación + control de visitas a la derecha (`lib/especialidades/quiropraxia/tool.tsx`). Captura por sesión: técnica de ajuste + listado por vértebra (texto libre), postura a mano alzada + nota, palpación estática/dinámica, leg check textual por modo, técnica general, termografía, notas libres. Radiografías como filas `documento_clinico` con signed URLs. Intake avanzado de 6 campos al alta (`intake.ts`). Tiene carry-forward de vértebras, versionado por visita (snapshot read-only), migración v1→v2 tolerante.

**(b) Qué hacen las planillas/estándares reales**
- **Intake de nuevo paciente**: motivo de consulta, **caracterización OPQRST del dolor**, **escala 0-10 (actual/mejor/peor)**, **diagrama corporal interactivo** para marcar zonas, antecedentes/traumas/fracturas, medicación/alergias, **revisión por sistemas con banderas rojas** (pérdida de peso, fiebre, dolor nocturno, vejiga/intestino), estilo de vida, y **cuestionarios de discapacidad adjuntos (Oswestry/NDI)**. ([pabau](https://pabau.com/templates/chiropractic-intake-form-template/), [carepatron](https://www.carepatron.com/templates/chiropractic-intake-form))
- **SOAP quiropráctico**: O incluye **ROM en grados vs. normal**, **pruebas ortopédicas** (Spurling, Kemp, SLR/Lasègue, FABER) **positivo/negativo por lado**, **examen neuro** (reflejos/dermatomas/miotomas), y **listings de subluxación por segmento**; P registra **técnica usada (Diversificada/Gonstead/Activator/Thompson)** y plan por fases. ([heidihealth](https://www.heidihealth.com/en-us/blog/chiropractic-soap-notes), [chirotouch](https://www.chirotouch.com/article/chiropractic-soap-notes-checklist))
- **Listing Gonstead**: nomenclatura estructurada (PR, PL, PRS…) por segmento. ([gonstead.com](https://gonstead.com/overviews-of-gonstead-technique/))
- **Travel card multi-visita**: grilla con fecha, **dolor 0-10 por visita**, segmentos ajustados, técnica, modalidades en checkoff. ([chiro.org](https://chiro.org/forms/TravelCards.shtml))
- **Outcome assessments estándar**: ODI, NDI, RMDQ, VAS/NRS, PSFS, FABQ/Tampa (banderas amarillas). El CMS Quality ID #182 **exige instrumento estandarizado + plan documentado**. ([chiro.org outcomes](https://chiro.org/LINKS/Outcome_Assessment.shtml), [ODI/APTA](https://www.apta.org/patient-care/evidence-based-practice-resources/test-measures/oswestry-low-back-pain-disability-index-oswestry-low-back-pain-disability-questionnaire-odi-odq))
- **Consentimiento informado** con riesgo de manipulación cervical alta y contraindicaciones declaradas. ([chsica ES](https://www.chsica.org/wp-content/uploads/2025/09/Chiropractic-Informed-Consent-Form-Spanish.pdf))

**(c) Brechas**
- **No hay ninguna escala de dolor ni EVA** (las columnas `eva_antes/eva_despues` existen en el writer pero `hideSoap===true` deja sin UI) → no se puede medir progreso del dolor a lo largo de las visitas. **Brecha #1.**
- **No hay outcome assessments** (Oswestry/NDI/PSFS) ni scoring → no cumple el estándar #182 ni demuestra mejora objetiva al paciente/obra social.
- **No hay diagrama corporal de dolor** (la postura es trazo libre sin marcado de zonas).
- **No hay ROM en grados, pruebas ortopédicas por lado, ni examen neuro estructurado.**
- **No hay banderas rojas/contraindicaciones estructuradas** en el intake → riesgo de seguridad antes de manipulación cervical.
- Notas por vértebra son texto libre **sin diccionario de técnicas/listings** (Gonstead).
- Asimetría entre vistas (posterior tiene occipucio/sacro/cóccix, lateral solo C1-L5); deuda legacy `vertebras_json`.

**(d) Ideas de mejora priorizadas**

| Prioridad | Mejora | Esfuerzo | Por qué importa + a qué se ata |
|---|---|---|---|
| **ALTA** | **EVA de dolor antes/después por sesión + sparkline.** Activar las columnas `eva_antes/eva_despues` que ya existen en `upsertSesion`; reusar el patrón `CardioSparkline`/`PsicoSparkline`. | Bajo | Es la métrica nº1 de quiropraxia y ya está medio-construida en el writer; cero migración de schema de columna. Cierra la brecha #1 con esfuerzo mínimo. |
| **ALTA** | **Outcome assessments digitales (ODI lumbar / NDI cervical) con autocálculo de score, % de cambio y tendencia**, integrados en la ficha. | Medio | Diferenciador fuerte vs ChiroTouch/Jane; demuestra mejora objetiva (clave para obra social y retención). Mismo motor de escalas que ya existe en psicología (`scorePhq9/scoreGad7`) → reutilizable. |
| **ALTA** | **Screening de banderas rojas/contraindicaciones en el intake** que dispara alerta antes de habilitar registro de manipulación cervical alta. | Bajo-Medio | Seguridad clínica + valor legal en repo PHI; encaja en `intake.ts` (hoy 6 campos genéricos). |
| **MEDIA** | **Diagrama corporal de dolor** reutilizando el canvas de postura ya existente (pointer events + polylines), con marcado por zona comparable entre visitas. | Medio | La infra de dibujo ya está; agrega valor clínico y se duplica entre visitas (carry-forward). |
| **MEDIA** | **Diccionario/autocompletado de técnicas (Diversificada, Gonstead, Activator, Thompson) y listings** en las notas por vértebra. | Bajo | Estandariza sin romper el texto libre actual; placeholders ya sugieren valores. |
| **MEDIA** | **Carry-forward completo** (no solo vértebras): arrastrar postura, palpaciones, leg check y termografía de la visita previa. | Bajo | La alta frecuencia de visitas quiro hace que re-tipear todo sea el dolor real; el gate por turno fresco ya existe. |
| **BAJA** | **Leg check estructurado** (medición de diferencia de longitud pre/post, lado deficiente) para técnica Activator. | Medio | Hoy es solo texto; valor para subgrupo Activator. ([activator.com](https://activator.com/optoelectric-measurement-of-leg-length-inequalities-before-during-and-after-isolation-tests/)) |
| **BAJA** | **ROM en grados + pruebas ortopédicas positivo/negativo por lado.** | Medio | Completa el "O" del SOAP quiro; menor urgencia que dolor/outcomes. |

---

### 2.2 Cardiología

**(a) Estado actual en Folio**
Ficha `cardiologia.cv.v1` en layout clásico (`pc-plan-grid`, herramienta ~380px + **SOAP visible**). Dos tarjetas: **Panel cardiovascular** (TA sist/diast, FC con rangos y hint "fuera de rango") + **checklist de 6 factores de riesgo** + **score de riesgo CV orientativo** (chip de color), y **Estudios** (ECG/Eco/Ergometría/Holter/Lab tipados: tipo/fecha/hallazgos/conclusión, hasta 30). **Sparkline SVG de TA/FC** (3 series). Intake avanzado de 8 campos al alta. Resumen es-AR por sesión.

**(b) Qué hacen las planillas/estándares reales**
- **Historia clínica cardiológica**: examen físico CV completo (TA ambos brazos, FC, FR, **SatO2, peso/talla/IMC, perímetro de cintura**, ingurgitación yugular, **auscultación S1-S4 y soplos grado 1-6**, pulsos 0-2+, edemas 0-4+), **estratificación de riesgo con score**, plan farmacológico/no-farmacológico, próximo control. ([agendapro](https://agendapro.com/blog/historia-clinica-cardiologica/), [soapnoteai](https://www.soapnoteai.com/soap-note-guides-and-example/cardiology/))
- **Plantillas por tipo de estudio** (no nota libre): **informe de ecocardiograma** (FEVI por Simpson, función diastólica E/e', válvulas), **ergometría** (registro por etapa de FC/TA/ECG, METs, conclusión isquemia), **Holter 24h**, **MAPA/presurometría** (patrón dipper/non-dipper, carga tensional). ([scielo eco](http://www.scielo.edu.uy/scielo.php?script=sci_arttext&pid=S1688-04202014000300022), [presurometria.com.ar](https://presurometria.com.ar/), [tcba](https://www.tcba.com.ar/cardiologia))
- **Apto físico deportivo** (Argentina): entrevista + examen + ECG reposo, conclusión apto/restricciones/no apto, **validez máx. 1 año**. Muy demandado en consultorio AR. ([wikicardio](https://www.wikicardio.org.ar/wiki/Apto_f%C3%ADsico_para_la_pr%C3%A1ctica_deportiva))
- **Scores validados**: **OPS/OMS (estándar regional recomendado, zona AMR-B)**, **SCORE2/SCORE2-OP (ESC 2021, AR como región de bajo riesgo)**, Framingham, **CHA₂DS₂-VASc** (anticoagulación en FA) y **HAS-BLED** (sangrado), **NYHA** (insuficiencia cardíaca), HEART (dolor torácico). ([calculadora OPS](https://www.paho.org/en/paho-cardiovascular-risk-calculator), [SCORE2 cardioteca](https://www.cardioteca.com/calculadoras-prevencion-cardiovascular/7785-calculadora-score2-score2-op-y-score2-diabetes-riesgo-cardiovascular-integrado-segun-guias-esc-2021-2025.html))
- **Nota de seguimiento de IC**: clase NYHA, balance hídrico/peso, tendencias BNP/NT-proBNP, FEVI, titulación. ([s10.ai](https://s10.ai/medical-specialties/cardiology/cardiology-clinical-note-templates))

**(c) Brechas**
- **El score de riesgo NO usa la edad** aunque la función la acepta y la edad del paciente está en la ficha (`scoreRiesgoCV(factores)` en `tool.tsx:359` sin el 2º arg; la función lo soporta en `schema.ts:160`). Es **conteo crudo de 6 checkboxes**, no usa TA/FC/colesterol/sexo. **Quick win + base para SCORE2/OPS real.**
- **Doble carga sin sincronización**: los factores del intake avanzado (al alta) **no precargan** el checklist por sesión → el profesional los re-marca cada vez; **no hay carry-forward del panel**.
- **Estudios sin adjuntos**: solo metadatos; no se puede subir el PDF/imagen del ECG/Eco (la galería con signed URLs es exclusiva de quiro, `SpecialtyToolProps.radiografias` se ignora en cardio).
- **Faltan vitales clave**: peso/talla/IMC, SatO2, perímetro abdominal, colesterol/LDL/glucemia, medicación cardiológica estructurada.
- **No hay plantillas por estudio** (Eco/Ergo/Holter/MAPA estructurados) ni informe/apto deportivo.
- Estudios no editables post-carga; sin alertas por valores críticos (solo hint de rango que bloquea guardado).

**(d) Ideas de mejora priorizadas**

| Prioridad | Mejora | Esfuerzo | Por qué importa + a qué se ata |
|---|---|---|---|
| **ALTA** | **Pasar `edad` al score y migrar a OPS/OMS o SCORE2** tomando datos ya cargados (edad, sexo, TA, colesterol, tabaco, diabetes). | Bajo (edad) / Medio (SCORE2) | El bug de edad es 1 línea; el score regional es el corazón clínico de la consulta cardio y hoy es casi inútil. Función pura ya existe (`scoreRiesgoCV`). |
| **ALTA** | **Adjuntar archivos a estudios** (PDF/imagen del ECG/Eco/Holter) reutilizando la galería + signed URLs de quiropraxia. | Medio | La infra ya existe (`documento_clinico` + storage); los cardiólogos viven recibiendo informes de estudios. Cierra la brecha de "EHR cardiológico que dropea el informe a la ficha". |
| **ALTA** | **Carry-forward del panel + precarga de factores desde el intake avanzado** (sincronizar antecedentes con el checklist). | Bajo | Elimina la doble carga; el gate por turno ya existe en quiro y se replica. |
| **MEDIA** | **Vitales ampliados** (peso/talla/IMC autocalculado, SatO2, perímetro, colesterol/LDL/glucemia) + **sparkline de peso/FEVI/BNP** para seguimiento de IC/HTA. | Medio | El sparkline ya está construido; sumar series es incremental y habilita el caso de IC (NYHA + tendencias). |
| **MEDIA** | **Plantilla de apto físico deportivo** con campos cardiológicos y **validez 1 año**. | Bajo-Medio | Altísima demanda en consultorio AR; venta directa. Encaja como variante de "tipo de estudio/nota". |
| **MEDIA** | **CHA₂DS₂-VASc + HAS-BLED** para pacientes en FA. | Bajo | Funciones puras como `scoreRiesgoCV`; decisión de anticoagulación de alto valor clínico. |
| **BAJA** | **Plantillas estructuradas por estudio** (Eco con FEVI/E-e', Ergometría por etapa, Holter, MAPA dipper/non-dipper). | Alto | Profundidad clínica premium; mayor esfuerzo, menor urgencia que adjuntos. |
| **BAJA** | **Medicación cardiovascular estructurada** (no solo textarea en intake) con adherencia/titulación. | Medio | Habilita el flujo IC y se conecta a futura receta electrónica + alertas de interacción. |

---

### 2.3 Psicología

**(a) Estado actual en Folio**
Ficha `psicologia.escalas.v1` en `pc-plan-grid` (380px + **SOAP visible**). 3 paneles: **(1) PHQ-9 + GAD-7** con scoring y banda automáticos, aviso si ítem 9 del PHQ-9 > 0, **sparkline longitudinal**; **(2) examen mental** (4 selects: apariencia/ánimo/afecto/curso del pensamiento + riesgo sin_riesgo/ideacion/plan con aviso de seguridad); **(3) objetivos terapéuticos** (texto + estado, "retomar de la última sesión"). Intake avanzado de 4 textareas al alta. Tests unitarios completos. Las escalas **persisten solo completas**.

**(b) Qué hacen las planillas/estándares reales**
- **Anamnesis psicológica completa**: motivo textual, historia del problema (inicio/evolución/desencadenantes), antecedentes psiquiátricos (internaciones, intentos, psicofármacos), **genograma/antecedentes familiares**, historia psicosocial, **consumo de sustancias**, examen del estado mental, **evaluación de riesgo**, hipótesis diagnóstica, **encuadre** (frecuencia/honorarios/modalidad). ([medesk](https://www.medesk.net/es/blog/anamnesis-psicologica/), [nubidoc](https://nubidoc.com/blog/anamnesis-psicologica/))
- **MSE completo** (~12 dominios): además de los 4 que tiene Folio, **sensopercepción, conciencia/orientación, memoria, lenguaje/habla, contenido del pensamiento, insight, juicio, conducta psicomotriz**. ([positivepsychology](https://positivepsychology.com/mental-status-examination/))
- **Formatos de nota seleccionables**: **SOAP / DAP / BIRP** con campos transversales (diagnóstico CIE/DSM, técnicas usadas, tarea/homework, riesgo de la sesión). ([mentalyc](https://www.mentalyc.com/blog/mental-health-progress-note-templates), [therapynotes](https://support.therapynotes.com/hc/en-us/articles/30874765568283-Complete-a-Progress-Note))
- **Formulación de caso (5 P / biopsicosocial)** y **plan de tratamiento** con objetivos medibles, indicadores, criterios de alta. ([heidi 4Ps](https://www.heidihealth.com/templates/case-formulation-4ps-ac44031e))
- **Evaluación de riesgo suicida estructurada** (C-SSRS): ideación/plan/intención, intentos previos, **acceso a medios letales, factores protectores, plan de seguridad documentado**. ([Columbia C-SSRS](https://www.columbiapsychiatry.org/research-labs/columbia-suicide-severity-rating-scale-c-ssrs))
- **Más escalas**: BDI-II, BAI, **ORS/SRS (PCOMS, monitoreo rutinario de resultados, validado en español)**, OQ-45, PCL-5, WHODAS 2.0, AUDIT/ASSIST. ([ROM](https://en.wikipedia.org/wiki/Routine_outcome_measurement))
- **Consentimiento + Ley 26.529 / 25.326** (secreto profesional y excepciones, habeas data). ([psik ley 26529](https://www.psik.com.ar/blog/historia-clinica-electronica-ley-26529))

**(c) Brechas**
- **Solo 2 instrumentos** (PHQ-9/GAD-7); sin C-SSRS, BDI/BAI, ORS/SRS, PCL-5, ni escalas configurables.
- **Riesgo = enum categórico** sin estructura (medios letales, factores protectores, **plan de seguridad documentado**) → el aviso solo recuerda documentarlo en SOAP. Gap clínico-legal sensible.
- **MSE mínimo** (4 selects) sin sensopercepción, conciencia, memoria, lenguaje, insight, juicio ni texto libre.
- **Objetivos** sin fecha/métricas/intervención/jerarquía; sin formulación de caso (5 P).
- **No hay plantillas de nota** (SOAP/DAP/BIRP) — reutiliza el SOAP genérico.
- Intake de 4 textareas sin estructura (CIE, intentos previos, sustancias, red de apoyo, genograma).
- Sin informes/PDF ni firma específica; el flag de riesgo aparece en vistas de lista (mitigado por RLS).

**(d) Ideas de mejora priorizadas**

| Prioridad | Mejora | Esfuerzo | Por qué importa + a qué se ata |
|---|---|---|---|
| **ALTA** | **Evaluación de riesgo estructurada (C-SSRS) + plan de seguridad documentado** que se dispara cuando ítem 9 PHQ-9 > 0 o riesgo = ideación/plan. | Medio | Es el gap de mayor riesgo clínico-legal; hoy el aviso no captura nada estructurado. Engancha con el banner `role=alert` ya existente. |
| **ALTA** | **Catálogo de escalas ampliable** (C-SSRS, BDI-II, BAI, **ORS/SRS para measurement-based care**, PCL-5) con el mismo motor de scoring/banda/sparkline ya construido. | Medio | El framework (`scorePhq9`, `deriveScoreSeries`, `CHIP_BANDA`) es genérico; sumar escalas es incremental y es el estándar de oro de la práctica moderna. |
| **MEDIA** | **MSE completo** (agregar sensopercepción, conciencia/orientación, memoria, lenguaje, insight, juicio + observaciones libres) como chips/dropdowns. | Bajo-Medio | Carga rápida con descriptores predefinidos; completa el examen mental sin romper el modelo de selects actual. |
| **MEDIA** | **Plantillas de nota seleccionables (SOAP/DAP/BIRP)** + campos transversales (CIE-10, técnica, tarea/homework). | Medio | Diferenciador tipo TherapyNotes; ata con el SOAP que psico ya muestra y con el módulo de plantillas general (§3). |
| **MEDIA** | **Objetivos enriquecidos** (fecha, métrica, intervención, indicador de logro) + **formulación de caso 5 P**. | Medio | Convierte objetivos planos en plan de tratamiento real; "retomar de la última sesión" ya da continuidad. |
| **BAJA** | **Mover el flag de riesgo fuera de vistas de lista** o gatearlo extra. | Bajo | Reduce exposición de indicador sensible (hoy mitigado solo por RLS). |
| **BAJA** | **Informe/PDF de evolución** con firma del registro. | Medio | Demanda administrativa; el lock/enmienda genérico ya existe como base. |

---

## 3. Mejoras generales de la app (de top-tech)

> Folio ya tiene la infra base de casi todo esto (WhatsApp Cloud + templates aprobados, cron dispatcher, MercadoPago, AFIP, RLS, cifrado, insights por cohorte). La mayoría son **extensiones**, no construcciones desde cero.

### Agenda / booking
- **[ALTA] Lista de espera inteligente.** Folio HOY no tiene waitlist (verificado en `lib/db/recordatorios.ts`). Tabla `lista_espera` (paciente, servicio, profesional, ventana preferida); cuando una cancelación libera un slot, ofrecerlo por WhatsApp por orden con link de auto-reserva a `/book/[slug]`. **Convierte cancelaciones en ingresos.** Fuente: [Jane App scheduling](https://jane.app/landing/scheduling).
- **[ALTA] Ventana de reserva configurable + auto-reprogramación 24/7** desde el recordatorio. Turnos del mismo día tienen ~2% no-show vs 33% a 15+ días. Fuente: [cloudcaremanager](https://cloudcaremanager.com/reduce-no-shows-with-deposits-reminders-and-waitlists-a-practical-guide/).
- **[MEDIA] Bot de reservas conversacional por WhatsApp (guiado por botones, no full-LLM al inicio).** Ya llega el webhook (`app/api/whatsapp/webhook`, HMAC `META_APP_SECRET`) y hay `availability` calculada. Fuente: [Docplanner Noa](https://customers.twilio.com/en-us/docplanner0).

### Cobros (MercadoPago)
- **[ALTA] Seña/depósito al reservar** descontable de la consulta. **La misma pasarela MP de la suscripción** puede cobrar al paciente en `/book/[slug]`; el código ya abstrae `PaymentProvider` (`lib/payments/`, confirmado: `index.ts`/`mercadopago.ts`/`types.ts`). Es la palanca anti-no-show más fuerte. Fuente: [dialoghealth](https://www.dialoghealth.com/post/reduce-patient-no-shows).
- **[MEDIA] Módulo de cobro a obra social/prepaga + dashboard de cuentas por cobrar.** Folio ya tiene AFIP (`lib/afip/wsfev1.ts`): registrar cobertura, generar facturación y ver pendiente/rechazado. Fuente: [DrChrono/Tebra revenue cycle](https://www.selecthub.com/medical-practice-management-software/drchrono-vs-tebra-practice-management/).

### Recordatorios / WhatsApp
- **[ALTA] Confirmación interactiva** (botones Confirmar/Reagendar/Cancelar en el mismo hilo). Evolución directa del recordatorio unidireccional actual; WhatsApp tiene 98% open rate. Si cancela, gatillar lista de espera. Fuente: [zealousweb](https://www.zealousweb.com/blog/reduce-no-shows-appointment-reminders-whatsapp-sms/), [neuwark](https://neuwark.com/blog/ai-patient-engagement-reduce-no-shows-2026).
- **[ALTA] Recalls por especialidad + campañas de reactivación.** Tipo `RECALL` con `scheduled_ts` = última visita + intervalo del servicio (quiro 4 sem, control cardio 6 meses) + vista "pacientes inactivos". Reusa el cron dispatcher; ingresos recurrentes. Fuente: [Cliniko recalls](https://www.cliniko.com/blog/news/whats-new-with-cliniko-may-2025/).

### Portal del paciente
- **[ALTA] Pre-admisión digital.** Extender el flujo público (`/book/[slug]` + `/invitacion/[token]`): el paciente carga intake, **firma consentimiento** y **responde escalas** (PHQ-9/GAD-7, ODI/NDI) **antes del turno**, cifrado a la ficha. El profesional llega con la escala basal cargada. Fuente: [SimplePractice portal](https://intuitionlabs.ai/software/behavioral-health-ehr-practice-management/client-portal-and-engagement/simplepractice-portal). Intake adaptativo: -31% charting, +26% factores de riesgo capturados ([mconsent](https://mconsent.net/blog/role-ai-enhancing-digital-new-patient-intake-forms/)).
- **[MEDIA] Teleconsulta nativa** (link único WebRTC tipo Daily/Whereby en el recordatorio). Folio no la tiene; relevante para psico y seguimiento cardio (Ley 27.553 habilita). Fuente: [Cliniko telehealth](https://www.medesk.net/en/blog/cliniko-review/).

### IA / notas asistidas
- **[ALTA, premium] AI scribe ambient es-AR.** Mayor tendencia 2025-26 (RCT: menos tiempo de doc y burnout; >50% adopción proyectada fin 2026). Grabar en navegador (MediaRecorder) → STT es → LLM prellena el SOAP **editable**. **CRÍTICO PHI: nunca persistir audio crudo, transcribir en memoria, guardar solo la nota cifrada (AES-256-GCM ya existe); human-in-the-loop + consentimiento explícito** (Folio ya tiene `consentimientos`). Monetizable como add-on. Fuente: [NEJM/PMC12973079](https://pmc.ncbi.nlm.nih.gov/articles/PMC12973079/), [scribing consent](https://www.scribing.io/blog/state-by-state-patient-consent-requirements-ai-scribing).
- **[MEDIA] Dictado por voz en campos largos** (es-AR con vocabulario custom: vademécum AR, obras sociales). Peldaño más barato que el scribe completo. Fuente: [speechmatics](https://www.speechmatics.com/company/articles-and-news/speechmatics-sets-record-in-medical-speech-to-text-with-93-percent-accuracy).
- **[MEDIA] Autocodificación CIE-10 sugerida** (marcada "sugerido por IA", con confirmación). Valor directo para facturación a obras sociales. Fuente: [glass.health](https://glass.health/resources/medical-ai-tools).

### Reportes
- **[ALTA] Tablero de KPIs operativos por org**: no-show%, % turnos cerrados, ingreso/paciente, activos vs inactivos, re-reserva. Folio ya tiene `analytics.org_insights_cache` + **benchmarking por cohorte geográfica** (`lib/db/insights.ts`) → el diferencial único es "tu no-show es 18% vs 9% de consultorios similares en tu ciudad". Sumar al cron M16 + vista `/reportes`. Fuente: [InetSoft](https://www.inetsoft.com/info/practice-management-dashboard-kpis-and-analytics/).
- **[MEDIA] Export FHIR de la ficha** (Patient/Encounter/Observation/Condition). Posiciona a Folio como interoperable ante la Red Nacional de Salud Digital. Empezar por export (low-cost) antes que ingestión. Fuente: [State of FHIR 2025](https://fire.ly/blog/the-state-of-fhir-in-2025/).

### UX
- **[MEDIA] Timeline cronológico unificado** del paciente (turnos, evoluciones, estudios, indicaciones) con los tokens `folio.css` existentes. El upgrade de UX de mayor percepción premium sin romper el design system. Fuente: [fuselabcreative](https://fuselabcreative.com/healthcare-app-ui-ux-design-best-practices/).
- **[MEDIA] Addendum firmado** (autor+timestamp+versión) en vez de edición de nota lockeada. Folio ya bloquea la sesión al cerrar; formalizar el patrón refuerza valor legal/auditoría (Ley 27.706). Fuente: [Jane charting](https://jane.app/landing/charting).
- **[BAJA] Auditar contraste WCAG AA** del tema cream/brass y evaluar dark mode como tokens en `:root`.

### Habilitantes de mercado / regulatorio
- **[ALTA] Receta electrónica.** **Obligatoria en AR desde 1-ene-2025** (medicamentos) y ampliada por **Res. 2214/2025** a estudios/prácticas. Sin esto un médico prescriptor **no puede operar legalmente solo con Folio**. Roadmap: campos del profesional (matrícula, REFEPS, jurisdicción, firma) en `member`/`organization` + entidad `receta` + integración con repositorio registrado en ReNaPDiS. Crítico para vender a cardiología/medicina general. Fuente: [integrandosalud](https://integrandosalud.com/home/receta-electronica-ley-27553-resolucion-2214-2025-requisitos-argentina/), [Boletín Oficial](https://www.boletinoficial.gob.ar/detalleAviso/primera/328614/20250721).
- **[BAJA, marketing] Comunicar compliance.** Posicionar el cifrado AES-256-GCM + RLS + audit trail como cumplimiento concreto de "inalterable/inviolable/auditable" de la Ley 27.706 — la mayoría de competidores locales no lo implementa. Fuente: [HCE Ley simple](https://www.argentina.gob.ar/justicia/derechofacil/leysimple/salud/historia-clinica-electronica).

---

## 4. Quick wins (alto impacto / bajo esfuerzo)

| # | Quick win | Por qué | Dónde toca |
|---|---|---|---|
| 1 | **Pasar `edad` a `scoreRiesgoCV`.** | Bug confirmado: `tool.tsx:359` llama `scoreRiesgoCV(factores)` sin el 2º arg que la función ya acepta (`schema.ts:160`). El score cardio ignora la edad teniéndola disponible. **~1 línea.** | `lib/especialidades/cardiologia/tool.tsx` |
| 2 | **Activar EVA dolor antes/después en quiropraxia.** | Las columnas `eva_antes/eva_despues` ya existen en `upsertSesion`; solo falta UI. Métrica nº1 de quiro, cero migración de schema. | `lib/especialidades/quiropraxia/*`, `lib/db/sesiones.ts` |
| 3 | **Reusar el job POST_VISITA para feedback/reseña (NPS corto).** | Ya se schedulea POST_VISITA a +2h del cierre (`recordatorios.ts:14`). Si es positivo → reseña pública; si negativo → captura privada. Alto impacto en adquisición. | `lib/db/recordatorios.ts`, cron dispatch |
| 4 | **Precarga/sincronización de factores cardio desde el intake avanzado.** | Elimina la doble carga; los antecedentes ya están guardados. | `lib/especialidades/cardiologia/tool.tsx` |
| 5 | **Carry-forward completo en quiropraxia** (postura/palpaciones/leg check, no solo vértebras). | El gate por turno fresco ya existe; ahorra re-tipear en una práctica de alta frecuencia. | `lib/especialidades/quiropraxia/tool.tsx` |
| 6 | **Botones interactivos en el recordatorio WhatsApp** (Confirmar/Reagendar/Cancelar). | Pasa de recordatorio pasivo a confirmación activa con la infra de templates ya aprobada. | webhook + dispatcher WhatsApp |

**Secuencia sugerida:** arrancar por los 6 quick wins (1-2 sprints) → en paralelo la apuesta de mayor ROI de plataforma (**seña MP + lista de espera + confirmación interactiva**) → luego **outcome assessments + C-SSRS** en las fichas y el **portal de pre-admisión** → y planificar los dos habilitantes de mercado (**receta electrónica** y **AI scribe es-AR**) como iniciativas mayores con su propio diseño de privacidad/compliance.