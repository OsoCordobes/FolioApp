# Comprobación acotada de contenido largo

12 de septiembre de 2026. Chromium aislado a 390×844, componentes reales y registros inventados. No se modificó producto ni se invocaron escrituras. Los actions se sustituyeron en el arnés y la red quedó limitada a GET de su servidor efímero local.

**No se encontró un recorte que impida leer o accionar en los casos completados.**

- Nombre compuesto: «María de los Ángeles Josefina del Carmen Fernández de la Fuente y Rodríguez de las Mercedes». El encabezado envuelve en varias líneas sin elipsis; las acciones permanecen accesibles.
- Motivo y nota: doce líneas de texto ficticio. En Información, el motivo crece verticalmente sin desbordar la página. En el editor, el campo conserva todo el valor y admite desplazamiento interno. En Editar plan, Control+Fin expone la última línea; el espacio de padding después del texto no se interpretó como contenido oculto.
- Descripción de estudio: «Ecocardiograma Doppler color transtorácico de seguimiento con informe descriptivo y comparación con el estudio anterior del consultorio de ejemplo». La tarjeta de Cardiología muestra la descripción completa y su enlace se puede alcanzar.
- Nueva cita, Cobro, Editar plan y Confirmación: los paneles quedan dentro de la ventana; los campos y botones se pueden alcanzar; Escape devuelve el foco al botón de origen. El documento mide 390 px, sin desbordamiento horizontal.
- Cardiología, Psicología, Kinesiología y Nutrición: nombre, motivo y nota revisados. Documento sin desbordamiento horizontal.

La evidencia se obtuvo en dos pases acotados. El primero completó seis casos y mostró dos problemas del propio arnés: espera de carga demasiado corta y una aserción que contaba el padding del textarea como texto oculto. Nueva cita y Plan se volvieron a comprobar satisfactoriamente tras ajustar esas mediciones. Quiropraxia confirmó el encabezado largo; su ejemplo sin turno no ofrece el mismo SOAP editable que las otras fichas y esa parte se dejó sin verificar al cerrar el alcance. No se presenta como defecto de producto ni como caso completo aprobado.

Capturas finales: `evidence/long-create-390.png`, `long-charge-390.png`, `long-plan-390.png`, `long-confirm-390.png`; `long-chart-{cardiologia,psicologia,kinesiologia,nutricion}-390-header.png` y `*-information.png`; `long-chart-cardiologia-390-study.png`. El encabezado parcial de Quiropraxia está en `long-chart-quiropraxia-390-header.png`.

Se revisaron las capturas de nombre largo, estudio y final de la nota. No se probaron nombres sin espacios, adjuntos reales, un teclado móvil real, persistencia ni resultados de servicios. No se añadieron reglas CSS por hipótesis ni se amplió el recorrido después de la indicación de cerrar e integrar.
