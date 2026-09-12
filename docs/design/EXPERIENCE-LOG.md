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

## Cierre de integración
- Diez capturas de fichas (cinco especialidades, dos tamaños); alta 2–8 y estados de finalización; acceso, directorio, reserva y portal inspeccionados. Los límites de cada recorrido están en AUTH.md y CLINICAL.md.
- Configuración recibe nombres accesibles para campos y selectores, estado anunciado de navegación y lenguaje comprensible. Se elimina una indicación de edición de datos fiscales que esa pantalla no ofrece. Finanzas conserva filtros/cálculos y añade nombre accesible al buscador y tipografía consistente en gráficos.
- Se corrigió el logotipo: trazados SVG independientes de IDs y fuentes. La prueba de navegación/recarga de recuperación no detecta errores de hidratación.
- La paleta de papel se restablece inmediatamente al imprimir. Pruebas DOM confirman ficha individual imprimible y agenda de varios pacientes oculta.
- Resultado final: 1.628 unidades, 16 escenarios Hoy, 14 creación, 14 interacciones, 22 públicos/impresión y 10 comparaciones visuales aprobados. Lint global aprobado; compilación aislada completa con tipos y lint aprobados.
- Se hizo un segundo build tras corregir resolución de plugins de ESLint para funcionar sin NODE_PATH heredado. No se deshabilitó el control. Las advertencias de instrumentación Sentry/OpenTelemetry se mantienen registradas; las lecturas de directorio fallan en el build sintético sin Supabase, como corresponde a este entorno.
- Se arrancó e inspeccionó la versión compilada local: portada/acceso/recuperación/imagen social 200; tres galerías nuevas 404. Pestañas del recorrido responden; consola de esa visita sin errores ni advertencias. Fuentes TTF presentes en trazas de ambas imágenes OpenGraph.
- Se restableció el servidor de desarrollo en 4410 para recorrer la entrega. No hubo despliegue, migraciones, cuentas ni movimientos reales.

## Siguiente validación antes de publicar
Entorno de ensayo conectado para autenticación, OAuth/correo, reserva completa, persistencia clínica y cobros reales de prueba. Esta entrega no presenta las vistas sintéticas como prueba de esos servicios.
