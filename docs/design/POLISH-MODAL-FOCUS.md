# Foco y guardado en diálogos de paciente y agenda

Revisión local del 12/09/2026: `ContactoModal`, `CoberturaModal`, `EnmiendaModal` y `BloqueoModal`.

## Hallazgos reproducidos

Los cuatro componentes usaban `autoFocus` antes de que `useModalA11y` registrara el botón que abrió el diálogo. El hook terminaba recordando el campo del propio diálogo y, al desmontarlo, no podía devolver el foco al botón de origen. Se reprodujo al cerrar con Escape, Cancelar y clic en el fondo.

Los cuatro fondos también llamaban `onClose` durante una acción pendiente, aunque Escape y Cancelar estaban bloqueados. El formulario desaparecía con el guardado aún en curso.

## Corrección acotada

- Contacto, cobertura y enmienda dejan que el hook enfoque su primer campo; se elimina el `autoFocus` redundante.
- Bloqueo conserva la fecha como foco inicial mediante una referencia y un efecto posterior al hook. Cambiar entre días completos y franja horaria mantiene el foco en el control elegido y conserva la fecha.
- El clic en el fondo respeta el mismo estado `pending` que los otros cierres.
- El hint del número de afiliado se alinea con el alta de pacientes: «Como figura en la credencial. Se guarda cifrado.»; evita términos internos y explica de dónde copiar el dato.

No se modificaron el hook compartido, las acciones, sus argumentos, validaciones, persistencia ni las reglas de agenda.

## Verificación

`node scripts/design-modal-focus-qa.mjs --before` reprodujo ambos defectos en 16 combinaciones. `node scripts/design-modal-focus-qa.mjs` pasó las mismas 16 combinaciones con los componentes corregidos: cuatro diálogos, 1440 × 1000 y 390 × 844, React en desarrollo con StrictMode y en producción, movimiento reducido.

Cada combinación verifica foco inicial, ciclo Tab/Shift+Tab, retorno de foco tras los tres cierres, bloqueo de Escape/Cancelar/fondo durante guardado, datos conservados tras un error, reintento con argumentos idénticos y retorno al botón de origen después de guardar. Bloqueo verifica además cambio de modalidad y el rango horario enviado. No hubo errores de página ni desborde horizontal en las capturas móviles.

ESLint de los cuatro componentes y `pnpm typecheck` pasaron. Las 37 pruebas unitarias existentes de rangos de bloqueo, cobertura y contacto también pasaron (`evidence/polish-modal-unit-results.txt`). Las capturas de los cuatro diálogos se revisaron en móvil; se revisó también Bloqueo en escritorio.

Evidencia: `evidence/polish-modal-focus-before.json`, `evidence/polish-modal-focus-after.json`, `evidence/polish-modal-{contacto,cobertura,enmienda,bloqueo}-{390,1440}.png`.

La prueba monta los componentes reales con acciones simuladas y tráfico permitido sólo a su servidor local. No verifica guardados reales, proveedores, base de datos ni un lector de pantalla físico. No se ejecutó un build global en esta subrevisión.
