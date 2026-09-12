# Folio: reconstrucción de la experiencia

## Entorno y alcance
- Base: 2dae580, rama codex/folio-experience, copia C:/Users/amiun/Documents/Codex/folio-experience.
- El otro trabajo continúa en su entorno. No se modifica master ni se despliega.
- Vista local: http://127.0.0.1:4410. Arranque: node scripts/design-dev.mjs.
- Entorno sintético: sin leer .env y con red del servidor limitada a loopback mediante las protecciones de pruebas existentes.
- Producto: profesionales de salud y equipos de consultorio en Argentina; agenda, atención, historia clínica, pacientes, cobros, reservas y portal.
- Los permisos, contratos de servidor, datos e integraciones se conservan.

## Exploración
1. Clínica clara: sans humanista, blanco y lavanda, tinta púrpura, composición horizontal de mensaje y agenda. La cercanía está en el lenguaje y las proporciones; la precisión en estados y datos.
2. Archivo vivo: serif editorial, verde pino y menta, documento vertical y pestañas de expediente. Refuerza continuidad clínica, pero da menos protagonismo a la agenda diaria.
3. Centro de práctica: cobalto y blanco, sans contundente, señalética lateral y agenda panorámica. Prioriza operación y densidad, con una primera impresión más institucional.

Los estudios visuales se guardan en /dev/design-directions.html. Se inspeccionaron los tres en navegador. Seleccionada **Clínica clara**: presenta mejor el trabajo diario sin la frialdad de Centro de práctica ni el ritmo pausado de Archivo vivo. La ficha toma el principio de continuidad de Archivo vivo sin convertirse en otro producto.

## Primera implementación
- Nueva página completa: agenda visible al entrar, recorrido interactivo agenda/historia/cobros, secuencia real de atención, especialidades, reservas/equipo/portal, controles de privacidad, precios de las fuentes reales, FAQ y cierre.
- Acceso: composición estable y formulario enfocado; onboarding con contexto, etiquetas claras y vista previa accesible.
- Plataforma: shell, agenda, fichas, pacientes, finanzas, configuración, reserva y portal comparten nueva tipografía, tokens y jerarquía.
- CSS incorporado a la compilación: versionado automático y actualizaciones en vivo. Se corrigió un comentario mal cerrado preexistente que el navegador toleraba pero el compilador detectó.
- Fuente local; se retiró la dependencia de Google Fonts en cada visita.
- Se quitaron promesas de cifrado de punta a punta, invisibilidad para el operador, tiempo de configuración y garantías de residencia/conservación que el código no acredita.
- Galería /dev/experience con componentes reales y fixtures, disponible solo en desarrollo aislado; impide escrituras. No acredita persistencia ni integraciones reales.

## Segunda revisión
- Landing inspeccionado en escritorio y móvil: navegación, Escape, pestañas y ausencia de desbordamiento. El recorrido abre en historia clínica para continuar la agenda del hero. Se aflojó el espaciado del titular tras observar letras demasiado juntas.
- Acceso y alta: formularios y servicios móviles revisados; se corrigen etiquetas, errores y gestión del foco de la vista previa.
- Fichas: los avisos de continuidad y la nota se agrupan para que la grilla no desplace el registro cuando aparece un aviso. Se revisan las cinco especialidades.
- Recursos: fuente local WOFF2 latina de 27.348 bytes (antes TTF de 176.288). Retiradas 821 reglas del carrusel de acceso que ya no se renderiza: CSS heredado de 684.048 a 531.101 bytes; gzip de 119.466 a 99.590. Medición de archivos, no de velocidad en producción.
- Los tres estudios permanecen en docs/design y se sirven en una ruta que responde 404 fuera del desarrollo aislado.
- Pruebas ejecutadas: 1.628 unidades; 16 de agenda y 14 de creación; 14 interacciones nuevas de teclado/selección/diálogo/permisos. Todas aprobadas. Tipos globales aprobados después de integrar fichas y fuente.

## Siguiente prioridad
Completar capturas de las cinco fichas, pasos de alta, estados públicos y pantallas de gestión; contrastar composición y móvil. Actualizar specs de la presentación reemplazada, ejecutar lint/build aislado y revisar el resultado final compilado. Guardar checkpoint antes de esta revisión final.
