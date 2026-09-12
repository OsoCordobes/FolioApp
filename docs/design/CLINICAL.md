# Fichas clínicas · Clínica clara

12 septiembre 2026. Inspección local de los componentes reales montados por `/dev/experience`, sin sesión ni acceso a datos reales. Se aplicaron frontend-design y ux-designer.

## Decisiones de presentación

La ficha mantiene el paciente y sus acciones al inicio, seguida por pestañas y la especialidad activa. En escritorio la herramienta y la nota SOAP tienen anchos similares; en una pantalla angosta pasan a una columna. Quiropraxia conserva su estructura propia de mapa y evaluación, sin agregar SOAP.

Se usa la paleta compartida: superficie blanca, fondo lavanda, tinta púrpura y acento violeta. La fuente Plus Jakarta Sans es local. Los títulos de tarjetas usan 14–15 px sin mayúsculas forzadas; los campos móviles usan 16 px y controles de 44 px de alto. El color de cada estado clínico conserva su significado original.

## Cambios

- `styles/clinical-experience.css`: encabezado, pestañas, tarjetas, lectura de ayudas, controles de formulario, radios y escala EVA, espacio para SOAP y acciones de guardado. Las reglas de presentación son de pantalla.
- `components/paciente/paciente-detalle.tsx`: agrupa los avisos de continuidad y SOAP en `pc-session-notes`, evitando que un aviso ocupe la segunda celda de la grilla y desplace la nota. El contenedor de acciones recibe una clase adaptable. Se conservan todos los handlers, estados y condiciones de guardado.
- `lib/especialidades/cardiologia/tool.tsx`: clase para alinear los campos vitales cuando sus etiquetas tienen distinta altura.
- `lib/especialidades/quiropraxia/spine-map.tsx`: selector nativo de la zona, construido con los mismos IDs del mapa, para abrir una vértebra sin apuntar a un área de pocos píxeles. Sólo cambia el estado local `selected`; las notas y sus handlers no cambian. Los dos SVG pasan de `img` a `group`, de modo que sus botones internos estén expuestos en accesibilidad.
- La revisión de impresión encontró que los tokens globales nuevos, importados después de `folio.css`, ganaban por orden de cascada a los tokens de papel. Un bloque final restablece exactamente la paleta de impresión existente. No se modifica el límite de impresión opt-in `[data-printable]`, su ocultación de otras rutas ni el reflujo A4. El selector nuevo está marcado `no-print`.

## Evidencia inspeccionada

Las diez imágenes `evidence/clinical-{especialidad}-{desktop|mobile}.png` son capturas del navegador local. Escritorio: 1440×1000. Móvil: 390×844. Se comprobó el ancho del documento: 1430 px y 381 px respectivamente (barra de desplazamiento excluida), sin desborde horizontal en las cinco fichas.

| Ficha real | Inspección realizada |
| --- | --- |
| Cardiología | Signos vitales, factores de riesgo, historial, estudios, medicación, derivación y SOAP. Cambio local de TA sistólica 120 → 125; navegación con flechas Información → Plan conserva 125 y el aviso de borrador. Se vuelve a 120 antes de abandonar el ejemplo. |
| Psicología | Escalas PHQ-9/GAD-7, apertura de PHQ-9 y sus nueve grupos con radios, examen mental y nota de proceso. En móvil cada radio queda dentro de una etiqueta táctil de al menos 44 px. No se administró ni interpretó una escala a una persona. |
| Quiropraxia | Mapa posterior, evaluación inicial y controles de visita. Selector C4 abre la técnica ficticia existente `diversificada`; los botones de vértebras e ilíacos aparecen en el árbol accesible. El contenedor del mapa es un grupo, no un botón. |
| Kinesiología | Motivo, EVA 3/10, curva, ROM, tests, instrumentos colapsables y objetivos. Los once valores EVA se reparten en dos filas a 390 px y conservan el seleccionado. |
| Nutrición | Peso/talla, IMC derivado existente, curva, circunferencias, pliegues, plan y objetivos. Las filas de medición ajustan su distribución para dejar lugar al selector y la acción. |

También se montó el modo sin turno editable para las cinco especialidades: el aviso contextual está presente, no hay botones Guardar sesión/Guardar y cerrar, y los controles de especialidad están deshabilitados o en lectura según su contrato existente. El selector del mapa continúa permitiendo consultar notas en lectura.

## Verificación y límites

- `pnpm typecheck`: completado sin errores tras los cambios de TypeScript.
- ESLint dirigido a paciente-detalle, spine-map y cardiologia/tool: completado sin errores.
- No se cambiaron schemas, fórmulas, scores, decisiones médicas, validaciones, acciones, DB, RLS ni contratos.
- La galería bloquea las solicitudes de escritura y las lecturas a servicios. Por eso algunos paneles que cargan su propia evolución o consentimientos muestran carga y el aviso de vista previa. No es evidencia de persistencia ni de integración con Supabase.
- La revisión inicial de impresión fue de fuente y cascada. En la integración también pasaron dos pruebas de impresión del DOM: ficha individual sobre fondo blanco y ocultamiento de la pantalla multipaciente. No se generó un documento médico PDF; ver `VERIFICATION.md`.
- La compilación en caliente puede reiniciar el ejemplo durante una edición del código. Los datos de esta galería son sintéticos.

## Revisión independiente de otras capturas

`auth-login-desktop.png`: no se detectó un problema visual de alto impacto; el acceso principal, sus alternativas y las etiquetas se distinguen con claridad.

`landing-mobile-v1.png`: la captura completa contiene encabezados repetidos visualmente; el archivo fuente actual tiene una única instancia de cada encabezado. Esto no prueba duplicación del producto. Para entrega conviene usar capturas por viewport o recapturar sin composición de zonas fijas.

## Imagen para compartir

La imagen OpenGraph de marketing usa la misma identidad y el texto actual “Tu consultorio. Todo a mano.”, con una agenda inventada y la aclaración de datos ficticios. Se verificó visualmente el endpoint generado por Next (`/opengraph-image-pwu6ef`) y se guardó el PNG 1200×630 en `evidence/marketing-opengraph.png`.

`lib/opengraph-fonts.ts` carga dos TTF estáticos locales (Regular y Semibold) desde `assets/fonts`. Son las fuentes oficiales de [tokotype/PlusJakartaSans](https://github.com/tokotype/PlusJakartaSans/tree/master/fonts/ttf); la licencia OFL está incluida junto a ellas. No se realiza una solicitud de fuentes al generar la imagen.

La imagen de reservas comparte el cargador de fuentes y la paleta base, conservando el nombre/acento elegido por el consultorio, consulta, exclusión de listados y metadata. Esa ruta no se abrió contra un consultorio real. Typecheck, ESLint y la compilación final completaron sin errores. Las trazas de ambas rutas incluyen los dos TTF (`evidence/opengraph-font-tracing.json`); la imagen de marketing respondió 200 como PNG desde el servidor local compilado.
