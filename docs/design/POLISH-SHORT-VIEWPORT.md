# Pantallas bajas y horizontal — 12 de septiembre de 2026

Se revisaron **844×390**, **1024×600** y **390×500** con navegador aislado, movimiento reducido y datos ficticios. La última medida aproxima el espacio disponible con teclado abierto; **no representa una prueba con teclado real, Safari móvil ni un dispositivo físico**. En el código actual, atender abre la ficha completa; el antiguo panel lateral no se monta.

## Defectos y correcciones

1. **Cobro recortado en horizontal.** Con un nombre completo de ejemplo, el panel medía 463,5 px dentro de una ventana de 390 px: comenzaba en −36,8 y terminaba en 426,8, sin desplazamiento interno. Ahora limita su altura a `100dvh − 32px` y permite desplazar su contenido. A 844×390 ocupa y=16…374. Se conservan el importe, los métodos, la deuda y el acceso rápido con Enter. [Antes](evidence/short-before-charge-844x390.png), [después](evidence/short-after-charge-844x390.png).

2. **Foco perdido al cerrar Cobro y Editar plan.** `autoFocus` ocurría antes de que el hook compartido capturara el botón abridor. Editar plan usa ahora el primer campo que enfoca ese hook. Cobro dirige el foco al botón de confirmación con un efecto local posterior a esa captura. El hook global no cambió. Escape, Cancelar/Volver y éxito sintético devuelven el foco al abridor.

3. **Campos y acciones clínicas debajo de la navegación móvil.** Un muestreo inicial no los detectaba; recorrer todos los campos visibles y las acciones mostró obstrucciones en las cinco fichas a 844×390 y 390×500. Por ejemplo, «Guardar sesión» de Kinesiología quedaba en y=343,9…389,9, detrás de la barra inferior. El documento de la ficha reserva ahora espacio de desplazamiento equivalente a la barra: 54 px de control + 14 px de padding + 1 px de borde + área segura, según las reglas reales de navegación. Los controles conservan 24 px de margen. La barra sigue visible y no cambian tipografía ni acciones. [Antes en horizontal](evidence/short-before-chart-kinesiologia-844x390.png), [después](evidence/short-chart-kinesiologia-844x390.png); [antes a 390×500](evidence/short-before-chart-cardiologia-390x500.png), [después](evidence/short-chart-cardiologia-390x500.png).

4. **Backdrop de Editar plan mientras guarda.** Con autorización específica de root, el clic fuera ahora respeta el mismo estado pendiente que Escape y Cancelar. Una prueba con respuesta diferida confirma que no se cierra; un error confirmado mantiene el texto y permite corregirlo. No se introducen reintentos automáticos ni cambios en la escritura del plan.

Todos los hallazgos se comunicaron antes de modificar los componentes. Archivos de producto cambiados en este ciclo: `components/hoy/cobro-cierre-dialog.tsx`, `components/paciente/plan-tratamiento-modal.tsx` y `styles/clinical-experience.css`.

## Verificación final

- `node scripts/design-short-viewport-qa.mjs`: **33/33**. Doce recorridos de Nueva cita, Cobro, Editar plan y Confirmación en las tres ventanas; seis pruebas de éxito/error diferido; quince combinaciones de ficha real y tamaño.
- `node scripts/design-short-viewport-qa.mjs --production`: **18/18**, repitiendo los modales y callbacks sintéticos con React de producción. No equivale a un build productivo de Next.
- En las cinco fichas se enfocaron y recorrieron **todos los campos visibles del estado de edición** y ambas acciones de sesión. Se verificó su geometría y el elemento que realmente recibe un clic en su centro. Las acciones de guardado de la galería no se ejecutaron.
- La muestra de cobro conservó exactamente **2.500.000 centavos, EFECTIVO, pagado=true** en su callback sintético. El plan mantuvo su nota tras error; el intento siguiente fue explícito y después de un resultado confirmado.
- ESLint focal, sintaxis del arnés y `git diff --check` sin errores. No se ejecutaron unidad global, build ni typecheck global; root gestiona la integración.

Resultados: [modales antes](evidence/short-viewport-before-results.json), [campos antes](evidence/short-viewport-fields-before-results.json), [final desarrollo](evidence/short-viewport-after-results.json), [final producción](evidence/short-viewport-after-production-results.json). Una repetición intermedia encontró el aviso de la propia galería por una lectura bloqueada que llegó tarde; el arnés ahora descarta únicamente ese aviso antes de medir, manteniendo todas las barreras de red y envío.

La evidencia no cubre estados clínicos opcionales cerrados, teclado físico/táctil real, persistencia, proveedores, cobros reales ni resultados inciertos del servidor. Nueva cita mantiene su acción de crear sustituida por una función que falla si se invoca; todos los efectos de éxito/error de este ciclo ocurren exclusivamente en memoria del arnés.

## Inventario posterior de autoFocus — sólo lectura

| Consumidor activo | Uso de autoFocus que permanece | Evaluación de fuente |
| --- | --- | --- |
| ContactoModal | Nombre, línea 135 | Montaje inicial desde Información de la ficha; candidato al mismo conflicto. |
| CoberturaModal | Obra social, línea 130 | Montaje inicial desde Información de la ficha; candidato al mismo conflicto. |
| EnmiendaModal | Motivo, línea 131 | Montaje inicial desde historial de ficha; candidato al mismo conflicto. |
| BloqueoModal | Fecha, líneas 159 y 182 | Abre desde Calendario en modo días; el campo inicial se monta con autoFocus. La segunda variante aparece al cambiar modo. |
| PedidoModal | Fecha/textarea, líneas 438 y 543 | Arranca en `mode="view"`; estos campos aparecen después al cambiar a horario/rechazo. No se presenta como el mismo conflicto inicial sin probar esa transición. |

Este inventario se envió a root para decidir alcance. No se modificaron esos consumidores en este ciclo. Alta de paciente quedó bajo la corrección paralela del agente de plataforma.

### Complemento posterior: estados opcionales abiertos

La limitación de escalas cerradas indicada arriba se amplió después en `tests/e2e/design-clinical-polish.spec.ts`: PHQ-9, GAD-7, NDI, ODI, Borg y MSE abiertos a 390×500 y 844×390, con ambas preferencias de movimiento. Se corrigió el foco que NDI/ODI recibían sin exponer el control, conservando el desplazamiento nativo y el foco de otros campos. La suite clínica final pasa 15/15; el detalle y las tres capturas se registran en `POLISH-CLINICAL.md`. Esta ampliación sigue sin representar un teclado móvil real.
