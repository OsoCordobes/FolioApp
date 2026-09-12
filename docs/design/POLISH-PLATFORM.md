# Pulido de plataforma — 12 de septiembre de 2026

Trabajo exclusivo en `folio-experience`, con datos sintéticos y servidor local 4410. No se modificaron servicios, permisos, reglas de cobro, proveedores, esquema ni persistencia. No se reinició el servidor ni se ejecutó un build en este ciclo.

## Cambios concretos

- **Pacientes:** el checkbox general comprueba los identificadores visibles. Antes, seleccionar un paciente y filtrar a otro podía mostrar «todos seleccionados» sólo porque había la misma cantidad. La selección parcial ahora muestra un guion y el foco de teclado se ve. El atajo `/` se suspende también durante la confirmación de WhatsApp; antes sacaba el foco del diálogo. No se envían mensajes en las pruebas.
- **Calendario:** Semana, Mes, Bandeja y filtros de estado anuncian su selección. Los turnos conservan el nombre completo accesible aun cuando la tarjeta sólo muestra iniciales. El desplazamiento a la hora actual respeta movimiento reducido. Los filtros ahora envuelven en móvil: antes el último botón extendía la página 14 px a 375 px.
- **Tablas móviles:** Pacientes y Finanzas explican que hay columnas desplazables. Sus contenedores reciben foco y responden a las flechas; los encabezados y filtros de Finanzas permanecen en su sitio al recorrer las columnas. Se conserva el contenido de todas las columnas y el símbolo de moneda permanece junto al importe.
- **Finanzas:** se reutiliza la normalización de búsqueda existente para que `tomas` encuentre a `Tomás`, con mayúsculas y espacios de borde. El filtro de estado sigue combinándose con el texto. No cambian importes ni acciones de cobro.

## Rendimiento: hallazgos y decisiones

El build previo de integración informa First Load JS de 424 kB en Hoy, 391 kB en Calendario, 352 kB en Pacientes, 317 kB en Finanzas y 331 kB en Configuración. Es una referencia de empaquetado de ese build, no una medición de velocidad ni del estado posterior de esta ronda.

Los modales de plataforma se importan estáticamente, pero usan controles nativos; no se encontró una biblioteca pesada de calendario/gráficos importada por esas pantallas. Se conserva la apertura inmediata del flujo de trabajo. Introducir división de paquetes requiere medir ahorro real en un build posterior y verificar espera/foco al abrir, por lo que no se hizo una optimización especulativa de imports. Se informó a root que `MotionProvider` conservaba `domMax` y comentarios sobre SideArt retirado para revisar sus consumidores bajo su propiedad.

La muestra de reposo se tomó después de cargar fuentes y el encabezado real de cada panel, en contextos de navegador independientes. Se dejó una ventana sin cambios/HMR para la muestra final, del 12 de septiembre a las 18:41:57 UTC. Cada intervalo dura 4 segundos:

| Panel sintético | Trabajo del hilo principal | Layout | Elementos DOM | Animación continua |
| --- | ---: | ---: | ---: | --- |
| Hoy | 23,11 ms | 1,38 ms | 813 | Dos indicadores de atención |
| Calendario | 5,93 ms | 0 ms | 982 | Un indicador de atención |
| Pacientes | 1,02 ms | 0 ms | 796 | Ninguna |
| Finanzas | 0,54 ms | 0 ms | 797 | Ninguna |
| Configuración | 0,81 ms | 0 ms | 762 | Ninguna |

Los cinco paneles no registraron errores de JavaScript. El bajo trabajo observado no justifica cambiar temporizadores de actualización clínica. Se revisaron `useNow` (una actualización por minuto) y el refresco de agenda (25 s, protegido por visibilidad); se mantienen sus contratos. Las listas ya usan memorización para filtros; no se añadió virtualización que pudiera afectar teclado, búsqueda o disponibilidad de filas.

**Límites:** la galería de desarrollo importa todos los paneles, herramientas, React de desarrollo y HMR. Descarga aproximadamente 17,4 MB de JavaScript sin minificar y 527.704 bytes de CSS en esa muestra. No son los tamaños de las rutas productivas. Una muestra anterior coincidió con HMR e informó recursos duplicados; se repitió con encabezados estables y sin cambios. Estos intervalos cortos no miden dispositivos lentos, persistencia, carga clínica grande ni coste total de CPU/GPU. No se atribuye una mejora de velocidad a estos cambios.

## Evidencia

- [Rendimiento y recursos](evidence/platform-performance.json), [salida](evidence/platform-performance.txt). Reproducible con `node --import ./scripts/testing/app-bootstrap.mjs scripts/design-platform-audit.mjs`.
- [Antes de corregir selección/foco](evidence/platform-interactions-before.txt): 14 escenarios previos aprobados y 4 nuevas comprobaciones fallidas, en React development/production. [Después](evidence/platform-interactions-after.txt): 18 de 18. Los casos usan componentes reales y límites sintéticos.
- [Suite plataforma](evidence/platform-e2e-results.txt): **8 de 8**; teclado del calendario, filtros, tildes en búsqueda, tablas móviles y movimiento reducido. El contenedor de galería bloqueaba inicialmente «Sin confirmar» por su filtro genérico de etiquetas. Con aprobación de root se añadió una excepción exclusiva para `.cal-filters`, que sólo filtra datos locales; las barreras de fetch y envío se mantienen. La repetición pasó los ocho casos.
- [Suite unitaria completa](evidence/platform-unit-results.txt): 1.628 aprobadas, 0 fallos/omitidas/canceladas.
- [TypeScript](evidence/platform-typecheck.txt) y [ESLint de archivos cambiados](evidence/platform-lint.txt), sin diagnósticos; códigos de salida en [platform-checks.json](evidence/platform-checks.json).
- [Móvil sin desborde de página](evidence/platform-shots.txt); la grilla de calendario y las tablas conservan desplazamiento dentro de su contenedor. Las capturas de `polish-*-mobile.png` y `polish-pacientes-selection.png` se inspeccionaron visualmente. Se usa consentimiento de cookies sintético para no tapar las pantallas.

Los casos nuevos están incluidos en el config aislado `playwright.design.config.ts`, junto con los de root y el agente clínico. Las pruebas generales de sesión/backend siguen fuera de esta evidencia; ningún resultado se presenta como un guardado o cobro real.
