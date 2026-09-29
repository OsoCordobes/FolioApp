# Folio — propuesta de reemplazos legales

29/09/2026 · Propuesta interna, sin aplicación ni publicación. Base local `d567eb3d3fb27f1e3868b068a08859ed6d065faf`. Se reutilizan L2/L3/L5/L6 del [informe aceptado](LAUNCH-LEGAL-SEO-PERFORMANCE.md) y sus fuentes verificadas el 27/09; no se repitió la auditoría ni se revalidaron proveedores en producción.

**Lectura:** **S** = fragmento sustentado, candidato a publicación tras revisión y coordinación; **T** = texto condicionado a implementar y probar el control descrito; **H** = falta dato o decisión humana, no publicable. Los bloques citados son reemplazos exactos; las notas y marcadores quedan sólo en esta propuesta. Ningún fragmento S convierte una política incompleta en un documento listo.

**Secuencia con B (L4):** conservar los textos y versiones históricos; acordar identificación del documento o conjunto aceptado, archivo de cada versión y tratamiento de cambios materiales antes de sustituir páginas. No reutilizar una versión anterior para un texto nuevo ni reescribir constancias. Manager coordina publicación; este paquete no cambia `lib/legal/versions.ts`, páginas, DPA ni SOP.

## 1. Derechos y plazos — L2

**S · [Privacidad §6](<../app/(public)/privacidad/page.tsx>), sustituir todo el contenido bajo «Derechos del titular»:**

> Podés solicitar acceso a tus datos personales, su rectificación o actualización y, cuando corresponda, su supresión. La Ley 25.326 establece diez días corridos para responder al acceso desde la intimación fehaciente, y cinco días hábiles para rectificar, actualizar o suprimir desde el reclamo o la advertencia del error. La supresión no procede cuando existe una obligación legal de conservación o puede perjudicar derechos o intereses legítimos de terceros.
>
> Para solicitudes relativas a tus datos de cuenta en Folio, escribí a folioasistencia@gmail.com. La solicitud de baja de cuenta y la cancelación de la suscripción son trámites diferentes del ejercicio de estos derechos.
>
> Para obtener una copia de tu historia clínica, dirigite al profesional o establecimiento que la custodia. La Ley 26.529 prevé la entrega de una copia autenticada dentro de las 48 horas de solicitada, salvo emergencia. Una descarga de datos de cuenta no equivale a esa copia clínica.

**S · [DPA §8.3](legal/DPA-template.md), reemplazar el plazo único por:**

> Los plazos aplicables se distinguen por solicitud: acceso, diez días corridos desde la intimación fehaciente; rectificación, actualización o supresión procedente, cinco días hábiles desde el reclamo o la advertencia del error; copia de historia clínica, 48 horas desde la solicitud, salvo emergencia. Estos plazos no se sustituyen por un plazo general de respuesta de soporte.

**Fuente:** [Ley 25.326, arts. 14 y 16](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion), [Ley 26.529, art. 14](https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432/actualizacion). **H/C:** confirmar receptor, verificación de identidad, derivación al custodio y entrega segura. Se describe el contacto ya publicado; no se acredita recepción del buzón ni cumplimiento operativo del plazo. No prometer exportación CSV/JSON universal: C debe aportar cobertura y prueba de entrega, incluida suscripción suspendida.

**S · DPA §8.1, reemplazar el inciso de exportación CSV/JSON:**

> El acceso a los datos de cuenta y la solicitud de copia de la historia clínica son trámites distintos. Una exportación de datos de cuenta no sustituye la copia clínica.

Formatos, cobertura y entrega operativa adicionales permanecen **H/C**. **S · DPA §8.2, reemplazar «Toda operación… queda registrada…» y su atribución al art. 14 por:**

> Folio registra actividad en las operaciones cubiertas por sus controles de auditoría.

## 2. Baja y conservación — L3

**S · [Términos §6](<../app/(public)/terminos/page.tsx>), reemplazar sólo el inciso de eliminación a 30 días; [Privacidad §7](<../app/(public)/privacidad/page.tsx>), reemplazar sólo el inciso de cuenta a 60 días; DPA §5.2, mismo texto:**

> La solicitud de baja de cuenta se registra para revisión humana. Antes de ejecutarla deben resolverse la conservación y la entrega autorizada de la información. La solicitud no programa una eliminación ni una pseudonimización automática. Puede cancelarse mientras está pendiente de revisión.

**S · Términos §4, reemplazar las dos frases desde «Folio retiene estos datos…»; Términos §6, primer inciso después del período abonado; Privacidad §7, inciso clínico; DPA §5.1:**

> La Ley 26.529 exige al profesional o establecimiento custodio conservar la historia clínica durante un mínimo de diez años desde la última actuación registrada. La cancelación de la suscripción y la solicitud de baja de cuenta no sustituyen esa obligación ni producen un borrado automático de la historia clínica.

Sólo en Términos §6, conservar antes de ese bloque la frase **«Al finalizar el período abonado, el acceso a la aplicación queda suspendido.»** Este cambio no redefine acceso ni facturación.

**S · Privacidad §7, reemplazar el párrafo final que remite a «estos mismos plazos»:**

> La cancelación de la suscripción o la falta de pago no ejecutan una eliminación automática de datos. El cierre de cuenta requiere resolver la conservación y la entrega autorizada de la información.

**S · DPA §8.1, reemplazar el inciso «Supresión: por pseudonimización…»:**

> Supresión: evaluación de la solicitud conforme a las obligaciones de conservación y los derechos de terceros. La solicitud no provoca una pseudonimización automática ni convierte los datos clínicos en anónimos.

**Fuente:** [flujo de baja](../app/api/cron/account-purge/route.ts), [UI vigente](<../app/(app)/configuracion/datos/datos-client.tsx>), leyes anteriores. **H/C + titular/asesoría:** retirar de la propuesta final las cifras no sustentadas de cuenta, logs, auditoría y respaldos; completar **categoría, custodio, plazo/criterio, inicio del cómputo, destino al terminar y excepciones**. Aplicar esa matriz a Privacidad §7 y DPA §5.3–5.4; no publicar dichas secciones como completas sin ella. No sustituir globalmente «30 días»: la prueba comercial y los preavisos son conceptos distintos.

## 3. Auditoría, enmiendas y respaldos — L6

**S · Privacidad §3, reemplazar los incisos «Audit log inmutable de toda…» y «Append-only… firmada digitalmente»; en DPA §4.3–4.4 usar estos mismos textos:**

> Auditoría: Folio registra actividad en las operaciones cubiertas por sus controles de auditoría.
>
> Enmiendas: las correcciones registradas mediante este mecanismo conservan la identificación del autor y el contenido de la enmienda.

No agregar «toda lectura/escritura», retención universal, certificación o equivalencia con firma digital. **Fuente:** [evidencia técnica L6](LAUNCH-LEGAL-SEO-PERFORMANCE.md), [enmiendas](../lib/db/sesiones.ts), [Ley 25.506](https://www.argentina.gob.ar/normativa/nacional/ley-25506-70749/actualizacion).

**H · Privacidad §3, inciso de backups; DPA §4.6: retirar la promesa «mínimo de 30 días» y «permiten la recuperación». Texto final a completar, no publicable con marcadores:**

> Las copias de resguardo abarcan [ALCANCE VERIFICADO]. Se conservan según [PLAZO O CRITERIO APROBADO, CON SU CÓMPUTO]. [DESCRIPCIÓN DEL CIFRADO ACREDITADO]. La recuperación cubre [COMPONENTES Y LÍMITES COMPROBADOS].

**Pendiente C:** política efectiva y prueba reciente de copia/recuperación; distinguir base, Auth, archivos y configuración. [Retención implementada](../scripts/backup/retention.mjs) selecciona siete días y cuatro semanas distintos; no prueba 30 días para cada copia ni recuperación integral. No reemplazar esa carencia por una garantía más vaga. Las demás afirmaciones amplias de cifrado/roles de Privacidad §3 y DPA §4 también necesitan alcance confirmado por C antes del cierre documental.

## 4. Preferencias, medición y mapas — L5

**S · [Cookies §2](<../app/(public)/cookies/page.tsx>), reemplazar los dos párrafos introductorios y la fila `ph_*`:**

> Folio utiliza almacenamiento del navegador para funciones del servicio y para recordar tu elección sobre la medición opcional de la página de inicio. Esa elección es independiente de las métricas agregadas de una organización.

| Elemento | Finalidad | Persistencia | Categoría |
|---|---|---|---|
| `folio.cookieConsent` | Recordar si permitís o rechazás la medición opcional | Sin vencimiento automático configurado; puede cambiarse o borrarse junto al almacenamiento del sitio | Preferencia de privacidad |
| Medición opcional de la página de inicio | Eventos de uso de la página de inicio cuando la medición está habilitada y la permitís | Configurada en memoria, sin persistencia de identificadores en cookies o almacenamiento local | Analítica opcional |

Estas dos filas no validan el resto de la tabla: **H/C** debe confirmar nombres/duración efectivos de autenticación, Turnstile y monitoreo; no republicar sus cifras como verificadas por esta propuesta.

**S · Cookies §3, sustituir todo el contenido:**

> Podés elegir «Permitir medición» o «Solo esenciales» en el aviso. La medición opcional de la página de inicio requiere tu elección afirmativa y respeta la señal Do-Not-Track. Cuando está habilitada, utiliza PostHog con persistencia desactivada. El ajuste de métricas agregadas de la organización es independiente y no cambia esta preferencia del navegador.

**S · Privacidad §4, reemplazar el inciso de PostHog:**

> PostHog: medición opcional de la página de inicio, cuando está habilitada y el visitante la permite. Respeta Do-Not-Track y está configurada sin persistencia de identificadores en el navegador. El ajuste de métricas agregadas de la organización es independiente.

Se retira la atribución genérica a «guías AAIP» y la falsa revocación desde Configuración. **Fuente:** [banner](../components/cookie-banner.tsx), [cliente analítico](../lib/observability/posthog-client.tsx), [opt-out organizacional](<../app/(app)/configuracion/privacidad-actions.ts>). Describe condiciones del código, no declara PostHog activo en producción.

**T · Sólo después del paquete P1 de abajo, agregar a Cookies §3–4:**

> Podés cambiar tu elección desde «Preferencias de privacidad», disponible en el pie de las páginas públicas. Elegí «Solo esenciales» para retirar el permiso de medición. Esto no cambia el consentimiento clínico ni cancela una reserva.

**T · Nuevo aviso junto al mapa, sólo cuando el iframe se cargue por acción expresa:**

> Al cargar el mapa, tu navegador se conectará con Google para mostrar la ubicación. Google recibirá datos de esa conexión, como tu dirección IP. Podés consultar la dirección sin cargar el mapa.

Controles exactos propuestos: **«Cargar mapa de Google»**, **«Ocultar mapa»**. Ocultarlo elimina el contenido incrustado; no revierte conexiones ya realizadas ni borra datos que Google haya recibido. Mantener la dirección en texto. No afirmar hoy que el mapa espera consentimiento: [el componente actual](../components/book-landing/book-landing-view.tsx) sólo usa carga diferida. Este paquete no sustituye la identificación de Google y su tratamiento en el aviso de privacidad.

## 5. Proveedores y transferencias — L6

**H · Privacidad §4 y DPA §6.1: no hay reemplazo completo publicable hasta recibir la matriz de C.** Eliminar del borrador la garantía genérica «la transferencia se ampara en las excepciones y garantías…». Cada fila final deberá responder, con datos confirmados:

> [IDENTIDAD DEL PROVEEDOR] trata [DATOS CONCRETOS] para [FINALIDAD]. Este tratamiento [ESTADO Y CONDICIÓN DE ACTIVACIÓN]. Los datos se tratan o pueden accederse desde [PAÍSES]. La transferencia se sustenta en [INSTRUMENTO APLICABLE IDENTIFICADO].

**Pendiente C/titular/asesoría:** contratos y destinos reales, instrumento por flujo, distinción responsable/encargado y habilitación efectiva; incluir Maps y Turnstile si corresponden. No deducir proveedor activo de una dependencia instalada. Brasil requiere evaluación como destino internacional; cifrado y alojamiento regional no acreditan por sí solos el instrumento. Fuente reutilizada: [AAIP, transferencias internacionales](https://www.argentina.gob.ar/transferencias-internacionales).

## 6. Procedimiento de incidentes — L6

**S · [SOP, marco normativo](legal/breach-notification-SOP.md), reemplazar referencias al art. 28 y a disposiciones no identificadas; corregir también la fila AAIP de roles:**

> La Ley 25.326 establece deberes de seguridad y confidencialidad en sus artículos 9 y 10; su artículo 29 regula el órgano de control. La Resolución AAIP 47/2018 contiene medidas de seguridad recomendadas. La obligación de notificar, sus destinatarios y sus plazos deben identificarse según el régimen aplicable y los compromisos contractuales del caso.

Fuente: [Ley 25.326](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion) y [Resolución 47/2018](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-47-2018-312662/texto).

**S · SOP, nota del marco normativo (línea 24) y §3.4 (línea 74), reemplazar respectivamente por:**

> Para cada incidente se debe identificar la norma o compromiso contractual aplicable, con su destinatario y plazo. Esta propuesta no acredita una obligación general basada en disposiciones sin identificar.

> La clasificación Crítico/Alto define una prioridad interna de evaluación. Las notificaciones exigibles se determinan por el régimen y los compromisos aplicables; la clasificación no crea ni excluye por sí sola una obligación legal de notificar.

**H · SOP §4.1, sustituir el encabezado que atribuye contenido mínimo a «Disposiciones AAIP» por «Información propuesta para preparar el informe del incidente».** C debe ratificar el listado operativo y añadir requisitos de la norma/contrato que se identifique; no declararlo contenido mínimo legal universal.

**H · Texto interno exacto para sustituir la introducción de SOP §4; pendiente ratificación C/titular:**

> Objetivos internos propuestos, pendientes de aprobación operativa: aviso preliminar al responsable del tratamiento dentro de 24 horas desde la detección y preparación de un informe dentro de 72 horas. No son plazos legales generales ni autorizan a demorar una obligación aplicable. Antes de notificar a una autoridad o a personas afectadas se identifica la obligación, el destinatario y quién debe realizar la comunicación, sin postergar las actuaciones exigibles.

Alinear tabla §4, reparto §4.2 y checklist final con ese carácter **propuesto**; reemplazar en todos ellos «reporte a la AAIP ≤72 h (art. 28…)» por **«Preparar informe según el objetivo interno aprobado e identificar las notificaciones exigibles»**. No presentar el plazo como aprobado mientras C no lo confirme.

**H · DPA §9.2, reemplazo sujeto a cierre del procedimiento contractual:**

> El procedimiento de incidentes documenta la detección, contención, investigación y las notificaciones que correspondan. Los objetivos operativos de un borrador no se incorporan como compromisos contractuales hasta que las partes aprueben su versión final.

Revisar conjuntamente DPA §9.1/§9.3 y SOP §1/§4.2 para asignar obligaciones según el rol en cada tratamiento; no atribuir siempre todas las notificaciones a la clínica. C debe completar responsable/suplente, canal y capacidad. La retención de evidencia del SOP remite a la matriz pendiente de §2 de esta propuesta; recuperación remite al alcance probado de §3, sin garantía universal.

## 7. Dos paquetes técnicos pequeños, pendientes de cupo

| Paquete | Propiedad propuesta y límite | Prueba de cierre |
|---|---|---|
| **P1 · Preferencias públicas + mapa** | Un escritor asignado por Manager: banner, acceso persistente desde páginas públicas, cliente analítico y componente de mapa. Coordinar puntos de entrada con Diseño; conservar CSS/tokens. Política/versión se publican junto al control probado y con B. No tocar consentimiento clínico, DB ni activar proveedores. | Contexto sintético: sin elección/rechazo no hay analítica; aceptación sólo habilita lo autorizado; revocación y cambio entre pestañas impiden eventos posteriores; DNT; navegación fuera de `/`; storage no disponible; formulario conserva datos. Mapa ausente de red antes de cargar, presente tras acción, iframe retirado al ocultar; dirección accesible. Teclado, foco y móvil. Typecheck y pruebas focales. |
| **P2 · Exclusión de indexación S1** | Un escritor: metadata de invitación, login, reset-password y layouts privados/portal; quitar login del sitemap. Preservar onboarding comercial y miniweb autorizada, sin `noindex` global en layout público. No debilitar autenticación ni iniciar revisión general de SEO. | HTML/cabeceras del candidato y URLs sintéticas: `noindex` en rutas previstas, ausencia del sitemap y acceso privado protegido. Conservar exclusiones ya presentes. No usar sólo `Disallow`, que puede impedir leer `noindex`. Typecheck; comprobación focal de rutas. |

Fuente de P2: [Google, noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing). Ninguno de estos paquetes se implementó aquí. Fechas/canonical del resto del sitemap y rendimiento permanecen fuera de este encargo.

## Entrega y aceptación

- **B:** coordinar archivo/versiones y constancias L4 antes de aplicar textos. No alterar registros anteriores.
- **C:** resolver matriz de retención/custodia/entrega, proveedor/datos/país/instrumento, respaldo/restauración y atención de derechos/incidentes. Los faltantes permanecen H; no se suplen con promesas.
- **Titular/asesoría:** identidad y domicilio del responsable/contratante, criterios clínicos de conservación y compromisos contractuales. No se inventan en esta propuesta.
- **Manager/Diseño:** asignar cupo y coordinar los puntos de acceso público; no cambiar la landing desde este chat.

Cierre de este paquete: documento único con reemplazos y destinos, fuentes reutilizadas, estados S/T/H, revisión independiente focal y enlaces locales comprobados. No se declara aprobación jurídica, corrección aplicada ni lanzamiento terminado. No se crean documentos adicionales ni se amplía la investigación.

**Verificación del 29/09:** revisor independiente de sólo lectura aprobó el borrador interno tras resolver tres observaciones sobre exportación, auditoría y notificaciones; sin errores materiales pendientes en el alcance. Comprobadas 16 referencias locales, todas existentes; sin cambios en archivos versionados. El informe anterior conserva SHA256 `4c58d2f70466a60c28f24cc7c8b79a14cb64466ff589fb9e4b5faba7f188b194`. No correspondía ejecutar pruebas de aplicación para esta entrega exclusivamente documental.
