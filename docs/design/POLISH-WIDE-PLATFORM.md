# Pantallas internas en monitores amplios

12 de septiembre de 2026. Revisión local de Hoy, Calendario, Pacientes, Finanzas y Configuración a 1920 × 1080, 2560 × 1080 y 390 × 844. Datos ficticios y red limitada a loopback. No se usaron servicios, cuentas reales ni guardados reales.

## Hallazgo y ajuste de ancho

Pacientes y Finanzas tenían el mismo contenedor de 1392 px a 1920 y 2560, con tablas de 1310 px. A 2560 sobraban 916 px en el área principal. Se informó antes de editar y root autorizó ampliar únicamente esas dos superficies de datos. Hoy conserva el límite para una lista cronológica legible; Configuración conserva el de formulario. Calendario ya utiliza el ancho disponible.

`styles/platform.css` aplica crecimiento continuo desde 1800 px: `clamp(1392px, calc(50vw + 492px), 1760px)`. Encabezados, filtros y tablas permanecen dentro del mismo contenedor.

Medición específica de redimensionado a 1799, 1800 y 1801 px: 1392, 1392 y 1392,5 px de contenedor. Se espera a que el navegador aplique el nuevo viewport antes de medir; la primera sonda inmediata aún leía el ancho anterior y se corrigió el arnés. [Medición de la transición y del formulario](evidence/wide-platform-dialogs-results-after.json).

| Viewport | Contenedor antes → después | Tabla antes → después |
| --- | ---: | ---: |
| 1920 | 1392 → 1452 px | 1310 → 1370 px |
| 2560 | 1392 → 1760 px | 1310 → 1678 px |
| 390 | 390 → 390 px | Pacientes 760; Finanzas 680 px, con desplazamiento interno |

Capturas revisadas: [Pacientes antes](evidence/wide-pacientes-2560.png), [después](evidence/wide-pacientes-2560-after.png), [Finanzas antes](evidence/wide-finanzas-2560.png), [después](evidence/wide-finanzas-2560-after.png). Los importes completos siguen visibles al desplazar la tabla móvil hasta su extremo.

## Interacción y hallazgos del formulario

En los 15 paneles medidos no hay desborde horizontal global, importes recortados ni errores de JavaScript. Los controles de texto habilitados examinados no presentan pares de color calculados por debajo de 4,5:1. La medición no cubre todos los estados ni sustituye una auditoría integral de contraste.

Los filtros de pacientes muestran tres filas con cobertura de ejemplo, tres particulares y una en Alta; selección general por teclado alcanza las seis filas visibles. Finanzas conserva dos pendientes y encuentra a Julián sin escribir la tilde, mostrando $ 25.000. La revisión detectó que el fixture usaba la cadena `Particular` donde el contrato espera `null`: se normalizó sólo `app/dev/experience/fixtures.ts`, con autorización. No se cambió el filtro real.

El detalle de calendario cabe en las tres pantallas y vuelve el foco a la tarjeta al cerrar con Escape. Se inspeccionaron las capturas de escritorio y móvil. Para alta de paciente se usa el componente real en un arnés independiente con acciones sintéticas, porque la galería bloquea esas aperturas como parte de su barrera de demostración.

Ese arnés detectó que `autoFocus` en Nombre tomaba el foco antes de que `useModalA11y` registrara el botón de apertura. Se retiró sólo el atributo redundante con autorización: el hook conserva el foco inicial en Nombre y puede devolverlo al botón al cerrar. No se alteró el hook compartido. [Fallo anterior](evidence/wide-patient-focus-before.txt).

La comprobación de pendiente encontró además que el fondo permitía cerrar el alta mientras la acción seguía pendiente, aunque Escape y Cancelar ya estaban protegidos. Root autorizó aplicar la misma condición al fondo. El formulario ahora permanece abierto mientras espera; tras un rechazo explícito conserva los campos, permite corregir Nombre y un nuevo clic produce exactamente una segunda llamada sintética. Ninguna acción real se ejecutó.

Las tres variantes de tamaño del formulario pasan: foco inicial en Nombre, cancelación mediante Escape/botón/fondo en reposo, retorno a Nuevo paciente, protección pendiente y reintento deliberado tras error. El formulario no incluye un botón X; no se agregó uno durante este ajuste. La tarjeta queda en 520 px de ancho en escritorio y 358 px en móvil, con scroll interno y acciones alcanzables. [Formulario móvil](evidence/wide-patient-dialog-390-after.png), [acciones móviles](evidence/wide-patient-dialog-actions-390-after.png).

## Evidencia y límites

Arnés: [design-wide-platform-audit.mjs](../../scripts/design-wide-platform-audit.mjs). [Mediciones originales](evidence/wide-platform-results.json), [15 paneles y 3 formularios después](evidence/wide-platform-results-after.json). Las comparaciones visuales se revisaron a partir de imágenes reales de Chromium. Las barreras de acciones y red permanecen intactas.

La ejecución integrada terminó con salida 0. Typecheck y ESLint del modal, fixture y arnés también finalizaron sin errores. Se repitieron unidades por la nueva guardia de pendiente: **1.628 de 1.628**, cero fallos, omitidas o canceladas. [Salida completa](evidence/unit-wide-platform-results.txt). No se ejecutó build ni se reinició el servidor.
