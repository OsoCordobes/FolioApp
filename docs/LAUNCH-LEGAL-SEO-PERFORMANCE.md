# Folio — Legal, privacidad, SEO y rendimiento

**Primer paquete cerrado: investigación e inventario; correcciones pendientes.** Corte: 27/09/2026, 00:22 Copenhague (26/09, 22:22 UTC). Responsable: este chat; coordinación: Launch Manager. Propiedad exclusiva de este archivo.

Base comprobada al inicio y al cierre de la investigación: `HEAD = origin/master = d567eb3d3fb27f1e3868b068a08859ed6d065faf`; checkout inicialmente limpio. Revisión de código, fuentes oficiales y observación pública acotada. No se modificaron aplicación, pruebas, configuración, dependencias, datos ni proveedores. No se ejecutaron migraciones, Docker, envíos, cargos ni publicaciones.

**Resultado:** hay discrepancias publicadas que corregir antes de presentar el frente legal como listo: identidad del proveedor incompleta, plazos de derechos incorrectos, baja/retención contradictorias y cookies desalineadas. SEO tiene omisiones delimitadas; falta medir el candidato final de la landing. No se encontró evidencia suficiente para afirmar cumplimiento jurídico, fuga de datos o buen rendimiento general.

Contexto de coordinación, no revalidación de producción: el [tablero vigente](C:/Users/amiun/.codex/worktrees/folio-launch-manager/folio-app/docs/LAUNCH-BOARD.md) mantiene PR188 `e4c1418` sin publicar por acceso/exportación y producción en 138 migraciones. La landing en `64d2/folio-app`, [preview 4440](http://127.0.0.1:4440/), sigue bajo Diseño. Su entrega final es dependencia de SEO/rendimiento, no objeto de otra revisión visual aquí.

Prioridades: **P1**, resolver antes del cierre comercial de este frente; **P2**, siguiente paquete de calidad; **P3**, condicionado al crecimiento. «Defecto» significa contradicción comprobada; «evidencia faltante» no significa que el control no exista. No se declara ningún P0.

## 1. Documentación y comportamiento legal, privacidad y cookies

### L1 · P1 · Identidad, roles y acuerdo de tratamiento incompletos

- **Evidencia / impacto:** [privacidad](<../app/(public)/privacidad/page.tsx>), líneas 33–39, identifica al responsable sólo como «Folio». [Términos](<../app/(public)/terminos/page.tsx>), líneas 237–239, ofrece un email, sin identificar a la persona contratante ni su domicilio. El [DPA](legal/DPA-template.md), líneas 5–15, sigue siendo plantilla y dice integrar los términos; no se encontró enlace/incorporación del DPA en los términos ni aceptación específica en `app`, `components` o `lib`. El profesional/centro aparece como responsable clínico y Folio como encargado: buena separación inicial, insuficiente para identificar las partes.
- **Corrección:** titular completa identidad legal, domicilio y datos fiscales pertinentes; asesoría valida roles por tratamiento, contrato/DPA, registro de responsable/bases y mecanismo de incorporación. No inventar sociedad, CUIT ni inscripción. La información previa debe identificar al responsable y su domicilio ([Ley 25.326, art. 6](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion)); verificar aplicabilidad y constancias con el [trámite AAIP](https://www.argentina.gob.ar/node/94924).
- **Cierre:** datos confirmados por titular; textos coherentes y accesibles antes del alta/reserva; DPA final con versión y constancia de incorporación; evidencia de inscripción aplicable o criterio jurídico documentado. La marca y el email solos no cierran este hallazgo.

### L2 · P1 · Plazos de derechos incorrectos y canales sin prueba operativa

- **Defecto:** [privacidad](<../app/(public)/privacidad/page.tsx>), líneas 159–178, agrupa derechos y promete respuesta en «10 días hábiles». La norma distingue acceso en **10 días corridos** (art. 14) y rectificación/supresión procedente en **5 días hábiles** (art. 16); [AAIP explica su ejercicio](https://www.argentina.gob.ar/aaip/datospersonales/derechos). La copia de historia clínica tiene régimen propio: **48 horas**, salvo emergencia, bajo [Ley 26.529, art. 14](https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432/actualizacion).
- **Corrección / impacto:** separar solicitudes de cuenta, derechos sobre datos y copia clínica; definir recepción, acreditación proporcional de identidad, derivación al custodio y entrega segura. No equiparar CSV/JSON de cuenta con copia clínica completa. El [contacto](../lib/support.ts), línea 18, es `folioasistencia@gmail.com`; la recepción y capacidad de respuesta no se probaron enviando correo.
- **Cierre:** textos corregidos, responsable operativo y procedimiento con plazos diferenciados; ensayo sintético de recepción/derivación/entrega, incluyendo suscripción suspendida. Reutilizar la prueba de exportación que cierre Manager; este informe no cierra B06 ni autoriza exportar historias reales.

### L3 · P1 · Baja y retención: promesas incompatibles con el flujo vigente

- **Defecto:** [términos](<../app/(public)/terminos/page.tsx>), líneas 159–161, promete eliminación a 30 días y pseudonimización. [Privacidad](<../app/(public)/privacidad/page.tsx>), líneas 190–196, dice 60 días para cuenta y 7 años para auditoría; líneas 83–84 dice 10 años para esa auditoría. El [endpoint de bajas](../app/api/cron/account-purge/route.ts), líneas 26–32, devuelve `review-only`, `manual_review_required`, `automatic_purge: false`: un plazo vencido no elimina ni pseudonimiza. No se ejecutó ese endpoint.
- **Corrección / impacto:** describir solicitud y revisión humana reales; resolver una matriz por dato, custodio, plazo, inicio del cómputo, obligación y destino tras baja, incluyendo respaldos. No activar una purga para hacer coincidir el producto con un texto. La guarda clínica mínima se cuenta desde la **última actuación registrada**, no simplemente «última atención» ([Ley 26.529, art. 18](https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432/actualizacion)). La supresión tiene excepciones de conservación (Ley 25.326, art. 16.5); pseudonimizar no equivale automáticamente a cumplirlas.
- **Cierre:** matriz aprobada por titular/asesoría clínica y legal, términos/privacidad/DPA/UI alineados, evidencia sintética de conservación y entrega al cerrar. Sin borrar ni reescribir historia previa; cierre sujeto al frente Continuidad.

### L4 · P1 · La constancia no identifica todas las versiones aceptadas

- **Defecto:** ambos caminos de [onboarding/actions.ts](<../app/(public)/onboarding/actions.ts>), líneas 275 y 365, guardan `p_consent_legal_text_version: "v1"`. [Versiones vigentes](../lib/legal/versions.ts), líneas 16–19: privacidad `2026-07-04`, términos `2026-07-24`. La UI **sí** enlaza ambos textos ([Step1Consent](../components/onboarding/step1-consent.tsx), 91–99); no falta ese enlace. [Reserva](../components/booking/booking-wizard.tsx), líneas 518 y 625–635, pide ambos pero envía sólo `PRIVACY_VERSION`; la [acción](<../app/(public)/book/[slug]/actions.ts>), líneas 161–191, admite una cadena del cliente sin comprobar una versión publicada concreta.
- **Corrección / impacto:** identificar el conjunto inmutable aceptado (o cada documento) con fecha y versión verificadas por servidor, preservando constancias históricas y conciliación por operación. Distinguir aceptación contractual, aviso/tratamiento de datos, opciones analíticas y consentimiento clínico. [Términos](<../app/(public)/terminos/page.tsx>), líneas 67–68, mezcla consentimiento informado y carga de datos; asesoría debe delimitarlo conforme a Ley 25.326, arts. 5–8, y Ley 26.529, arts. 5–7. Una casilla de reserva no acredita consentimiento a una práctica médica.
- **Cierre:** altas email/retorno OAuth e invitación/reserva sintéticas conservan el documento efectivamente presentado; versiones ausentes/inválidas se rechazan sin escrituras parciales; cambiar términos no altera el historial. Producto/Acceso coordina cualquier cambio de aplicación o esquema. PR188/intake queda pendiente de revisión sobre su candidato final, sin prometerlo como publicado.

### L5 · P1 · Cookies: revocación pública y tabla desactualizada; mapas sin control propio

- **Defectos de código/texto:** [banner](../components/cookie-banner.tsx), líneas 124–140, persiste la elección y desaparece; no se encontró control público para reabrirla. [Política](<../app/(public)/cookies/page.tsx>), líneas 85–118, describe `ph_*` durante un año y revocación desde Configuración. Sin embargo, el [cliente analítico](../lib/observability/posthog-client.tsx), líneas 21–22, 49–72, sólo permite `/`, consentimiento vigente y DNT; carga SDK después de aceptar, usa memoria y deshabilita persistencia. El [opt-out de Configuración](<../app/(app)/configuracion/privacidad-actions.ts>), líneas 24–48, modifica agregados de la organización, no `folio.cookieConsent` del visitante. Son controles diferentes.
- **Mapa / impacto:** [miniweb](../components/book-landing/book-landing-view.tsx), líneas 295–296, monta `iframe` de Google con `loading="lazy"` al existir URL, sin consultar preferencias. `lazy` difiere la carga, no constituye consentimiento. [Validador](../lib/book-landing/map-embed.ts), líneas 1–14, limita a Maps: evita orígenes arbitrarios, pero no resuelve información al visitante. La política enumera Calendar, no Maps. No se afirmó que Google hubiera instalado cookies en una miniweb real.
- **Corrección:** control público persistente para cambiar/revocar medición; inventario de almacenamiento realmente usado (incluido `folio.cookieConsent`), duración y finalidad; distinguir seguridad, analítica y contenido externo. Propuesta a validar: mapa bajo acción «Cargar mapa» con explicación del tercero y alternativa de dirección/enlace. Sustituir la afirmación genérica «AAIP exige consentimiento únicamente para cookies no esenciales» por fundamento preciso por tratamiento; no importar automáticamente un régimen europeo por la ubicación del titular.
- **Cierre:** contexto sintético limpio: antes de elegir/rechazar no sale analítica; aceptar permite sólo eventos autorizados; revocar vuelve a impedirlos sin perder formulario, también entre pestañas; DNT y navegación a rutas clínicas se respetan. Verificar mapa antes/después y tabla contra red/almacenamiento **sintéticos**, sin capturar cookies/tokens reales. Estado hoy: mecanismos estáticos inspeccionados; esa matriz dinámica aún falta.

### L6 · P1 · Proveedores, transferencias y garantías necesitan evidencia concreta

- **Evidencia faltante:** [privacidad](<../app/(public)/privacidad/page.tsx>), líneas 95–141, lista proveedores sin distinguir habilitados, opcionales y pendientes. Omite Cloudflare/Maps aunque aparecen en cookies/código. [DPA](legal/DPA-template.md), sección 6, usa destinos «Internacional» y garantías genéricas; São Paulo también es transferencia internacional. Brasil no figura en la lista AAIP consultada; hace falta identificar el instrumento aplicable, no inferir suficiencia por cifrado o cercanía ([AAIP: transferencias](https://www.argentina.gob.ar/transferencias-internacionales)). No se verificaron contratos, regiones o subencargados en consolas.
- **Promesas a sustentar:** privacidad, líneas 73–90, afirma cifrado de PII/PHI, toda lectura/escritura auditada, enmienda «firmada digitalmente» y backups cifrados de al menos 30 días. [Enmiendas](../lib/db/sesiones.ts), 471–493, registra autor/texto cifrado, sin acreditar firma digital bajo [Ley 25.506](https://www.argentina.gob.ar/normativa/nacional/ley-25506-70749/actualizacion). [Retención de backups](../scripts/backup/retention.mjs), 15–37, selecciona 7 días y 4 semanas distintos: no garantiza 30 días para cada copia. Verificar alcance operativo antes de prometerlo. El [SOP de incidentes](legal/breach-notification-SOP.md), 19–24 y 80–85, atribuye control al art. 28 de Ley 25.326 (trata encuestas; control está en art. 29) y cita disposiciones sin identificar; sus 24/72 horas son objetivos internos, no un plazo legal general demostrado aquí.
- **Corrección / cierre:** matriz tratamiento→proveedor→datos→destino→estado→contrato/garantía, validada por titular y Continuidad/Proveedores; lenguaje comercial limitado a controles probados; fundamento y roles de incidentes corregidos. Responsable y prueba de backups/recuperación referenciados, sin cambiar proveedores ni activar correo/Google/cargos. La [Resolución AAIP 47/2018](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-47-2018-312662/texto) es una fuente identificable de medidas recomendadas; no certifica Folio.

### L7 · P2 · Alcance comercial y cláusulas pendientes de validación humana

- **Evidencia / impacto:** [términos](<../app/(public)/terminos/page.tsx>), secciones 5–11, promete trial, cobro, cancelación, avisos con 30 días, reembolsos y limitación de responsabilidad. La landing pública muestra «Recordatorios por email» y «Conexión con Google Calendar»; el tablero mantiene pruebas/habilitaciones de proveedores separadas. No se probó aquí su disponibilidad general. No afirmar que las cláusulas de no reembolso/límite de daños sean válidas sólo por estar escritas.
- **Corrección / cierre:** con Diseño y Continuidad, tabla breve de oferta publicada frente a habilitación y prueba; titular/asesoría valida condiciones de contratación, alcance profesional/consumidor y jurisdicciones aplicables. Alinear FAQ/precios/términos al candidato final. Evidencia de cancelación/soporte y avisos antes de prometerlos; sin cargos ni comunicaciones nuevas por este encargo.

## 2. Indexación, SEO y rendimiento

### S1 · P1 · Invitaciones sin exclusión explícita; completar matriz privada

- **Defecto:** [invitación](<../app/(public)/invitacion/[token]/page.tsx>), línea 28, sólo define título; [robots](../app/robots.ts), líneas 21–29, no la excluye. Layouts de staff/portal tampoco declaran política `noindex` general. Un enlace descubierto podría indexarse; la pantalla anónima de invitación es neutral (49–52): **no se demostró exposición de contenido privado**.
- **Corrección:** `noindex` en invitación y matriz explícita para recuperación, cuenta y portal; `/login` aparece hoy en sitemap (línea 25): definir su exclusión junto al resto de acceso, manteniendo onboarding comercial si se decide indexable. No usar robots como control de acceso ni bloquear el rastreo del documento neutral antes de que se pueda leer `noindex` ([Google](https://developers.google.com/search/docs/crawling-indexing/block-indexing)).
- **Cierre:** invitación sintética y páginas de acceso emiten exclusión en HTML/cabeceras del candidato; no están en sitemap; las áreas privadas siguen requiriendo autenticación. `/t/[token]`, `/mis-datos`, `/archivo-clinico` y MFA ya tienen `noindex`: preservar esas defensas.

### S2 · P2 · Directorio y legales: canonical/social incompletos

- **Defecto:** [directorio](<../app/(public)/profesionales/page.tsx>), líneas 17–21, y [especialidades](<../app/(public)/profesionales/[especialidad]/page.tsx>), línea 26, sólo definen título/descripción; legales tienen el mismo patrón. El template raíz añade otra marca al título del directorio: navegador público confirmó **«Profesionales de la salud · Folio · Folio»**.
- **Corrección / cierre:** títulos compatibles con template; canonical absoluto por ruta y metadata social pertinente, sin parámetros de atribución. Validar HTML, imagen social accesible y representación compartida del candidato final. La landing actual sí mostró canonical y OG propios; no reemplazarlos por un canonical raíz común a todas las rutas. No se afirma penalización de ranking.

### S3 · P2 / P3 · Sitemap: fechas artificiales y límite heredado

- **Defectos:** [sitemap](../app/sitemap.ts), líneas 21–48, asigna `new Date()` a todas las páginas al generarse. Reutiliza la consulta de UI [directorio](../lib/db/directorio.ts), línea 64, limitada a 200 organizaciones: el truncamiento es **P3 condicionado**, no se comprobó ese volumen en producción.
- **Corrección / cierre:** usar fecha del cambio significativo o omitirla ([Google: lastmod](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)); regeneración sin cambios no inventa novedades. Consulta paginada específica; fixture con 201 elegibles completo, conservando exclusión de internas, borradas y deslistadas. No recorrer organizaciones reales para probarlo.

### S4 · P2 · Rendimiento final pendiente; CSS global es una hipótesis medible

- **Evidencia:** [layout raíz](../app/layout.tsx), líneas 3–10, importa ocho hojas de toda la aplicación: **674.885 bytes de fuente**, incluidos estilos clínicos/onboarding/editor. Esto **no es tamaño transferido**, CSS usado ni prueba de lentitud. La [evidencia anterior](design/evidence/platform-performance.json), líneas 2–3, declara galería sintética local del 12/09, no rutas productivas. No reutilizarla como certificación de la landing nueva.
- **Corrección propuesta:** con SHA final fijado, medir antes de separar estilos por área. Comparar `/` y miniweb sintética con/sin mapa, carga fría/caliente, móvil/escritorio, movimiento normal/reducido. Conservar identidad violeta, calidad visual y accesibilidad; sin desactivar movimiento sólo para mejorar un número.
- **Cierre:** registrar versión de navegador/build, dispositivo/viewport, CPU/red/caché, recursos JS/CSS/fonts, LCP/CLS y respuesta de interacciones; declarar si INP es dato de campo o sólo diagnóstico de laboratorio. Corregir una causa relevante y comparar con condiciones iguales, verificando navegación/diseño. No se requiere puntuación Lighthouse universal ni nuevos servicios pagos.

### Evidencia pública recogida en esta revisión

**HTTP — producción**, `https://foliosalud.com`, 27/09/2026 00:17 +02. Una solicitud GET por ruta, `curl.exe`, Windows de esta estación, sin autenticación ni cookies suministradas; compresión negociada, red habitual sin limitación artificial. Caché del servidor no controlada. TTFB desde cliente incluye conexión/TLS. **No renderiza JS y no mide Core Web Vitals ni experiencia móvil.**

| Ruta | HTTP | Primer byte, s | Total, s | Cuerpo transferido, bytes |
|---|---:|---:|---:|---:|
| `/` | 200 | 0,519369 | 0,529311 | 17.462 |
| `/privacidad` | 200 | 0,512320 | 0,519800 | 6.362 |
| `/terminos` | 200 | 0,524373 | 0,524626 | 6.485 |
| `/cookies` | 200 | 0,163430 | 0,163638 | 5.769 |
| `/robots.txt` | 200 | 0,526081 | 0,526143 | 220 |
| `/sitemap.xml` | 200 | 0,601663 | 0,601800 | 346 |

**Navegador integrado — observación DOM pública**, `/`, `/cookies`, `/profesionales`. Landing: canonical `https://foliosalud.com`, OG 1200×630, 18 elementos script externos al HTML del mismo origen, sin iframe presente. Eso no demuestra ausencia de conexiones mediante fetch/SDK. Cookies: tabla antigua y sólo instrucciones de navegador/Configuración, sin control público de revocación. Directorio: estado vacío; no se inventó slug ni se exploraron enlaces privados para obtener miniweb. El banner no apareció en este navegador; su estado previo era desconocido y no se leyó ni alteró almacenamiento/cookies. Por ello **no hay PASS de aceptación/rechazo/revocación ni inventario dinámico completo de terceros**. La evaluación de rendimiento del navegador no estuvo disponible en la superficie de lectura; no se reportan métricas inventadas.

**Controles aprovechables comprobados en código:** miniweb tiene canonical sin `?ref`, OG/Twitter y `noindex` ligado al consentimiento de directorio ([page.tsx](<../app/(public)/book/[slug]/page.tsx>), 157–177); JSON-LD condicionado, sitemap con filtros de publicación; perfiles personales separados quedan noindex. Fuente local de 27.348 bytes con `display: swap`; imágenes con dimensiones/`sizes`; SDK analítico diferido. La revisión estática independiente de la landing candidata observó mecanismo de movimiento reducido/pausa: no sustituye prueba del candidato final. Ningún consentimiento o dato clínico real se abrió.

## Decisiones humanas y próximos paquetes

| Decisión pendiente | Quién / dato necesario | Trabajo que puede seguir |
|---|---|---|
| H1 · Identidad contratante, domicilio, CUIT/datos fiscales pertinentes, jurisdicciones y registro AAIP | Titular + asesoría; no deducir residencia societaria por ubicación personal | Preparar estructura de textos y L2/L5/S1 |
| H2 · Custodia, retención por categoría, baja y entrega al terminar contrato | Titular + asesoría clínica/legal + Continuidad | Corregir contradicciones documentales sin activar borrado |
| H3 · Proveedores/países/contratos, garantías, backups, responsable de derechos e incidentes | Continuidad/Proveedores aporta prueba; titular confirma compromisos | Inventario y borradores limitados a evidencia |
| H4 · Alcance adulto, consentimiento clínico, firma, cláusulas comerciales y oferta habilitada | Asesoría + Producto/Calidad/Diseño | Versionado contractual y revisión de metadata, sin decidir política clínica |

1. **Paquete A — textos y contrato verificables (L1–L4/L6/L7).** Primero resolver plazos/contradicciones y preparar borrador con datos humanos pendientes identificados. Coordinar con Continuidad y Calidad. Publicación sólo tras revisión jurídica/titular de lo material y coordinación de Manager; un borrador no es aprobación.
2. **Paquete B — preferencias públicas y mapas (L5).** Un escritor asignado por Manager, componentes/políticas concretos; pruebas sintéticas de red y revocación. Separar el opt-out organizacional. No activar integraciones.
3. **Paquete C — indexación y metadata (S1–S3).** Writer asignado por Manager; exclusiones, canonical/títulos y fechas reales. Límite 200 puede diferirse hasta necesitar escala. Pruebas con HTML y fixtures; sin crawler masivo.
4. **Paquete D — rendimiento del candidato final (S4).** Después del cierre de Diseño, fijar SHA/preview, tomar línea base reproducible y elegir una mejora fundada. CLI de Vercel no está instalada según contexto de sesión: se recomienda `npm i -g vercel` para una futura fase operativa autorizada; no es requisito de este inventario ni se instaló aquí.

**Criterio de aceptación de este primer paquete cumplido:** dos bloques separados, hallazgos con ubicación/impacto/corrección/prueba de cierre, fuentes oficiales consultadas el 27/09/2026, observación pública y medida con límites explícitos, decisiones humanas y paquetes acotados. Dos revisores de lectura apoyaron SEO y consistencia legal; ningún escritor de aplicación adicional. Manager decide prioridades y cupos; no se continúa una auditoría general por inercia.

Fuentes primarias complementarias consultadas: [AAIP, obligaciones de responsables](https://www.argentina.gob.ar/node/53779), [Google, canonicalización](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [Next.js 15, CSS](https://nextjs.org/docs/15/app/getting-started/css). Los enlaces normativos anteriores apuntan al texto actualizado cuando está disponible. Las referencias a artículos son base de revisión, no acreditación legal de Folio.
