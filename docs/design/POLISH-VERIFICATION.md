# Verificación de la ronda de pulido

12 de septiembre de 2026. Ronda posterior a `8f1a6d5`, en `codex/folio-experience`, conservando la dirección Clínica clara. Este índice reúne la evidencia de responsive, microinteracciones, foco, marca y lectura. La [verificación del rediseño original](VERIFICATION.md) permanece disponible por separado.

## Cómo leer los resultados

Las cantidades de cada fila pertenecen a su propia ejecución. Algunas pruebas se repiten dentro de la integración y entre revisiones: **no se suman como pruebas únicas**. Las repeticiones de las 1.628 unidades tampoco son conjuntos distintos.

- **Arnés React:** monta componentes reales con acciones y respuestas sintéticas. Sus variantes `NODE_ENV=development` y `NODE_ENV=production` corresponden a React y a ese montaje aislado; no son un build de Next ni evidencia de despliegue.
- **Navegador sobre Next de desarrollo:** usa el servidor aislado de 4410, datos ficticios y barreras de red/escritura. Permite comprobar composición, teclado y estado local.
- **Next compilado localmente:** requiere build y comprobaciones posteriores de ese snapshot. El checkpoint intermedio no valida los cambios que llegaron después.

## Resultados por módulo

| Módulo y registro | Resultado confirmado | Evidencia concreta | Límite principal |
| --- | --- | --- | --- |
| [Marca, cinco fichas y recorrido](POLISH-LOG.md) | 14 de 14 escenarios de especialidades, teclado, altura estable, menú y movimiento reducido. Símbolo inspeccionado a 16, 32 y 48 px. | [Ejecución](evidence/polish-landing-tests.txt), [marca](evidence/polish-brand-studies.png), [16 px](evidence/polish-logo-16.png) | Next de desarrollo; las fichas de portada son ilustraciones. |
| [Portada en pantallas amplias](POLISH-RESPONSIVE.md) | Diez anchos, de 320 a 3440 px, sin desborde global ni errores JS observados. Revisión adicional con texto CSS duplicado. | [Geometría](evidence/wide-responsive-results.json), [revisión independiente](WIDE-SCREEN-REVIEW.md) | CSS px; duplicar texto no equivale a zoom nativo o a un dispositivo físico. |
| [Sección activa de navegación](POLISH-SCROLLSPY.md) | 5 de 5: secciones y regreso al hero, cambio de ancho y limpieza al desmontar. | [Ejecución](evidence/scrollspy-e2e-results.txt), [estado posterior](evidence/scrollspy-after.json) | Navegación local y un montaje sintético del componente; sin lector de pantalla real. |
| [Plataforma](POLISH-PLATFORM.md) y [revisión cruzada](POLISH-REVIEW-PLATFORM.md) | 8 de 8 escenarios de navegador; 18 de 18 de interacción React; 6 de 6 sobre nombre accesible de turnos y contexto opcional. | [Navegador](evidence/platform-e2e-results.txt), [interacción](evidence/interaction-results.json), [tarjetas](evidence/platform-cross-review-results.json) | Conjuntos parcialmente repetidos por la revisión. Importes y mensajes son sintéticos. |
| [Pacientes y Finanzas en monitores amplios](POLISH-WIDE-PLATFORM.md) | 15 combinaciones de panel y tamaño, tres tamaños del alta y comprobación dirigida de transición de ancho. Filtros, selección, cierre pendiente y reintento explícito comprobados. | [Paneles y formularios](evidence/wide-platform-results-after.json), [transición y formulario](evidence/wide-platform-dialogs-results-after.json) | El alta usa un arnés React; no se registra un paciente real. La medición dirigida sustituye la sonda de breakpoint inicial. |
| [Fichas clínicas](POLISH-CLINICAL.md) | Última suite ampliada: 15 de 15. Foco visible al abrir/quitar escalas, protección del campo ya enfocado, borrador al cambiar pestañas y mapa. | [Registro final de la revisión](POLISH-CLINICAL.md#revisión-final-de-foco-y-estados--12-septiembre-2026), [NDI](evidence/polish-disclosure-ndi-390x500.png), [ODI](evidence/polish-disclosure-odi-390x500.png) | Sustituye la cobertura inicial de 7 casos; no acredita guardado clínico ni un lector de pantalla real. |
| [Ventanas bajas y diálogos de cobro/plan](POLISH-SHORT-VIEWPORT.md) | 33 de 33 en recorrido de desarrollo y 18 de 18 al repetir los modales con React de producción. Controles expuestos y respuestas diferidas conservadas. | [Desarrollo](evidence/short-viewport-after-results.json), [React producción](evidence/short-viewport-after-production-results.json) | Los 18 son una repetición de parte del alcance. 390 × 500 aproxima espacio con teclado; no prueba un teclado móvil real. |
| [Contacto, cobertura, enmienda y bloqueo](POLISH-MODAL-FOCUS.md) | Las mismas 16 combinaciones que reprodujeron los defectos pasan tras corregir foco y cierre durante pendiente. | [Antes](evidence/polish-modal-focus-before.json), [Después](evidence/polish-modal-focus-after.json) | Cuatro diálogos, dos tamaños y dos modalidades de React; acciones simuladas. |
| [Acceso, alta del consultorio y reserva](POLISH-ACCESS.md) | 16 de 16 recorridos de interacción; 46 unidades pertinentes. Foco, validación, correo conservado y movimiento reducido. | [Interacción](evidence/polish-access-results.json), [reserva móvil](evidence/polish-access-booking-mobile-after.png) | Las 46 unidades forman parte de la suite general. No se envían correos ni reservas; sólo primeros pasos de reserva en la app local. |
| [Portal e invitaciones](POLISH-PORTAL.md) | 16 de 16 recorridos React; 49 unidades pertinentes. Pestaña visible, error que conserva datos y retorno de foco. | [Resultados](evidence/polish-portal-results.json) | Las unidades se solapan con la suite general. Sin Auth, aceptación de invitación o persistencia reales. |
| [Errores, avisos y tabla de cookies](POLISH-STATES.md) | 24 de 24 recorridos React: pausa/reanudación del aviso, limpieza de temporizadores, recuperación y tabla desplazable. | [Resultados](evidence/states-results.json) | React de desarrollo/producción, con Sentry sustituido; no prueba recepción de eventos ni vigencia jurídica. |
| [Revisión de carga, reenvío y contraste](POLISH-CROSS-REVIEW.md) | 9 de 9 escenarios de navegación/encabezado; 8 de 8 del cooldown; 4 de 4 estados focales de tema/ancho. Contraste de etiqueta: 4,46 → 4,68. | [Navegación](evidence/cross-e2e-results.txt), [cooldown](evidence/email-cooldown-results.json), [contraste posterior](evidence/cross-contrast-after.json), [dependencias](evidence/cross-dependencies.json) | Costes aislados de esbuild no equivalen a ahorro real de Next; revisión de pares no es auditoría WCAG completa. |
| [Marca en imagen para compartir](POLISH-BRAND-OG.md) | Endpoint del segundo build local 200, PNG de 1200 × 630 inspeccionado con el símbolo compartido. Ambas rutas OpenGraph incluyen las dos TTF locales en sus trazas. | [Respuesta compilada final](evidence/polish-marketing-opengraph-final.json), [imagen](evidence/polish-marketing-opengraph-final.png), [trazas finales](evidence/polish-opengraph-font-tracing-final.json) | Se invoca sólo la imagen de marketing; la imagen de reserva se comprueba por sus trazas, sin consultar su backend. |
| [Textos de plataforma](POLISH-COPY.md) | Jerga interna reemplazada por instrucciones; baja descrita como revisión humana sin plazo no respaldado. Lint y tipos sin errores. | [Cambios y comprobación de contratos](POLISH-COPY.md) | Sólo texto; no se modifican las políticas legales, acciones o garantías de seguridad. |

## Checkpoint compilado confirmado

El build intermedio de las 19:11 UTC pasó compilación, tipos y lint: [salida](evidence/polish-build-first.txt). La portada informa **217 kB First Load**, frente a los 223 kB del checkpoint anterior; es una estimación de bundle de Next, no una medida de tiempo de carga.

El [recorrido HTTP compilado](evidence/polish-production-smoke.json), registrado a las 19:14 UTC, comprobó 12 rutas/recursos. Portada, login, recuperación, cookies, favicon, icono e imagen para compartir respondieron 200. Las **cinco galerías nuevas verificadas** respondieron 404: `/dev/experience`, `/dev/directory-preview`, `/dev/design-directions.html`, `/dev/brand-studies` y `/dev/invitation-preview`. Este resultado no incluye la ruta heredada `/dev/book-preview`.

Las unidades se repitieron después de cambios de lógica y pasaron **1.628 de 1.628** en cada checkpoint documentado: [plataforma](evidence/platform-unit-results.txt), [cooldown](evidence/unit-cooldown-results.txt) y [guardia de alta](evidence/unit-wide-platform-results.txt). Esto no reemplaza la ejecución final sobre todos los cambios reunidos.

### Fuentes e imagen en el segundo build

Comprobación independiente a las 20:12 UTC sobre el commit `2d02096`, build `Sr0tdXv5RNBdPY4pKAzR_`, servido como Next compilado en 4410. Las trazas de ambas rutas OpenGraph incluyen `PlusJakartaSans-Regular.ttf` y `PlusJakartaSans-SemiBold.ttf`; los archivos existen, con 128.972 y 129.288 bytes, y se registran sus hashes. La evidencia intermedia se conserva: [trazas finales separadas](evidence/polish-opengraph-font-tracing-final.json).

La portada cargó una única WOFF2 con respuesta 200, `font/woff2`, **27.348 bytes** y hash idéntico al archivo local. `document.fonts` informa la familia cargada y Chromium identifica **Plus Jakarta Sans** como fuente personalizada usada en los 27 glifos del título, no una sustitución de Arial. No hubo errores de consola o página en esa visita. [Carga real de fuente](evidence/polish-landing-font-final.json).

El endpoint de marketing respondió 200 con PNG de **1200 × 630**, 68.425 bytes. Se abrió e inspeccionó: símbolo Hoja clara actual, texto y composición legibles, sin recortes observados. [Imagen compilada final](evidence/polish-marketing-opengraph-final.png), [respuesta y hash](evidence/polish-marketing-opengraph-final.json). Sólo se realizaron GET/HEAD en loopback; no se invocó el endpoint de reserva, las galerías ni servicios reales.

## Integración local final — resultados confirmados

La integración local de esta ronda quedó verificada sobre `2d02096`. Los registros siguientes sustituyen los pendientes de las iteraciones anteriores; conservan por separado las primeras ejecuciones y sus correcciones.

| Comprobación | Resultado confirmado |
| --- | --- |
| Suite pública integrada | **73 de 73 aprobadas, 2,0 min**: [salida final](evidence/polish-integrated-public-final.txt), [resultado estructurado](evidence/public-e2e-results.json). Incluye ocho casos clínicos añadidos. La [primera ejecución de 64 de 65](evidence/polish-integrated-public.txt) se conserva; su espera agotada de scroll reducido se corrigió esperando la vista montada. La repetición completa confirma el resultado sobre la integración posterior. |
| Comparación visual | **14 de 14 aprobadas, 21,9 s**, en una comparación posterior **sin actualizar snapshots**; [salida de comparación](evidence/polish-visual-compare.txt). Previamente se generaron e inspeccionaron los 14 baselines: [generación](evidence/polish-visual-update.txt), [hashes](evidence/polish-visual-baseline-hashes.json). |
| Tipos finales | **Salida 0 global confirmada por el coordinador**; [registro final sin diagnósticos](evidence/polish-typecheck-final.txt). Se conserva la [salida inicial](evidence/polish-typecheck-initial.txt) con los dos errores de tipado de callbacks del spec clínico que se corrigieron antes de repetir. |
| Lint final | **Salida 0 global**; [registro final](evidence/polish-lint-final.txt). |
| Unidades finales | **1.628 de 1.628**, sin omitidas ni canceladas; [salida completa final](evidence/polish-unit-final.txt). Es una nueva ejecución del mismo conjunto, no 1.628 pruebas adicionales a los checkpoints. |
| Segundo build | **Build de `2d02096` aprobado**, identificador `Sr0tdXv5RNBdPY4pKAzR_`; [salida](evidence/polish-build-second.txt). Portada: **218 kB First Load**, frente a 223 kB del cierre original y 217 kB del checkpoint intermedio. Es una medida de bundle, no una promesa de velocidad. |
| Comprobación HTTP y composición compiladas | **12 rutas/recursos comprobados** y capturas a **1440, 1920, 2560 y 3440 px**, sin desborde horizontal ni errores de página/consola observados; [registro final](evidence/polish-production-smoke-final.json). Las cinco galerías nuevas responden 404; portada, acceso, recuperación, cookies, favicon, icono y PNG de marketing responden 200. No incluye `/dev/book-preview`. |
| Perfil de ejecución compilada | **Dos contextos nuevos**: 1440 × 900 sin ralentización y 390 × 844 con CPU ×4 y latencia sintética de 150 ms. Ambos registran cero errores de página/consola y ningún desplazamiento de contenido sin interacción reciente durante la muestra; las tres transiciones mantienen su altura. [Perfil](evidence/polish-runtime-profile.json), [salida](evidence/polish-runtime-profile.txt). No son Core Web Vitals de usuarios reales ni una auditoría completa de rendimiento. |

La muestra móvil ralentizada registra dos tareas largas de 205 y 162 ms; no se ocultan al describir la estabilidad visual. Las observaciones proceden de loopback y condiciones artificiales: no acreditan tiempos en dispositivos físicos, redes reales ni comportamiento de producción.

## Estado de publicación

El usuario dejó sin efecto la duración fija solicitada inicialmente y autorizó terminar, integrar y publicar el rediseño. La incorporación de `master a0fe34e` a la rama del rediseño terminó sin conflictos en el commit local **`b15bc52`**. Su diferencia respecto de `2d02096` contiene únicamente los cinco archivos de M118: migración, dos pruebas, workflow SQL y documentación; la fuente de la aplicación permanece idéntica al snapshot probado.

La CI del PR debe verificar ese commit combinado. **No se declara todavía el PR integrado en `master` ni el despliegue completado.** Esos resultados se registrarán por separado. El [checkpoint previo al release](RELEASE-CHECKPOINT.md) conserva el inventario de otras ramas y la separación de alcance.

Estas pruebas no certifican producción, Supabase Auth/RLS/Storage, correos, proveedores, pagos ni el recorrido guardar → reabrir contra datos persistidos reales. No se modificaron base de datos, servicios o permisos para esta ronda.
