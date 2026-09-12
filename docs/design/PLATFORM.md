# Plataforma Folio: Clínica clara

La experiencia conserva las rutas, permisos y contratos del producto. Los cambios afectan la presentación y la navegación accesible. La base es la dirección elegida por el equipo: fondo lavanda muy pálido, superficies blancas, tinta violeta, acento violeta y verde azulado para resultados positivos. Los colores se consumen mediante los tokens globales, incluidos los de tema oscuro. Plus Jakarta Sans sirve para títulos, lectura y cifras tabulares.

## Composición

- **Marco de trabajo:** la marca, el consultorio y el profesional tienen lugares propios. La navegación presenta cinco destinos como máximo y un estado seleccionado claro. El menú móvil conserva las opciones secundarias y añade un botón de cierre visible.
- **Hoy:** fecha y acción de atención sin turno; cuatro indicadores compactos; lista cronológica con énfasis exclusivo en la atención en curso. El estado y los cobros conservan sus cálculos y etiquetas reales. La acción flotante sólo se presenta en móvil.
- **Calendario:** cuadrícula blanca, horarios alineados y día actual lavanda. Se preserva el desplazamiento horizontal de la semana en pantallas angostas.
- **Pacientes:** nombres visibles y accionables con teclado, selección rotulada, filtros con estado anunciado y etiquetas en español. La tabla conserva todos sus datos en móvil mediante desplazamiento horizontal.
- **Ficha:** identidad estable, pestañas de lectura y áreas de escritura con espacio. Secciones clínicas a una columna en tablet y móvil; no se elimina ningún campo para hacer espacio.
- **Finanzas:** indicadores juntos para comparar, ingresos confirmados en verde y pendientes con su semántica original. Gráficos y transacciones conservan los datos y cálculos existentes.
- **Configuración y suscripción:** navegación de categorías, formularios de lectura clara y estados de guardado conservados. Reserva y portal reciben tipografía y espaciado coherentes, respetando el acento configurado por consultorio.

## Criterio de diseño

El énfasis cambia según la tarea: una lista cronológica para atender, una cuadrícula para organizar horarios, una ficha para leer y escribir y cifras alineadas para comparar. Se quitaron los rótulos monoespaciados en mayúsculas, los gradientes del turno en curso y las sombras decorativas. Se mantienen foco visible, estados por texto además de color, reducción de movimiento y controles de al menos 40–44 px en recorridos principales.

## Alcance y comprobación

`styles/platform.css` se carga después del estilo heredado. No cambia acciones del servidor, contratos de base de datos, permisos ni reglas de cobro. Se modificaron componentes presentacionales de sidebar, navegación móvil, cabecera e indicadores de Hoy y tabla de pacientes. El directorio agrega un botón de apertura de ficha que reutiliza el mismo callback de navegación.

Validación inicial: TypeScript global y ESLint de los cinco componentes modificados pasaron. La inspección visual se realiza en la vista local `/dev/experience`, con componentes reales y datos sintéticos; esa vista no prueba persistencia, autenticación, reservas reales, cobros ni servicios externos. No constituye verificación de producción.
