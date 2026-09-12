# Verificación funcional del rediseño

Fecha: 12 de septiembre de 2026. Entorno: worktree `folio-experience`, rama `codex/folio-experience`. Las pruebas siguientes usan datos sintéticos; no leen archivos `.env`, no acceden a producción y no registran pacientes, cuentas ni cobros reales.

Este documento conserva la evidencia de la ronda original. El cierre posterior del pulido está en [POLISH-VERIFICATION.md](POLISH-VERIFICATION.md): 73 de 73 escenarios públicos integrados, 14 de 14 comparaciones visuales sin regenerar, 1.628 de 1.628 unidades, tipos/lint finales correctos y build local `2d02096` verificado. Los resultados por módulo y sus repeticiones no se suman como pruebas únicas; la publicación se registra por separado.

## Resultados comprobados

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Suite unitaria completa | 1.628 aprobadas; 0 fallos, omitidas o canceladas | [unit-results.txt](evidence/unit-results.txt) |
| Panel Hoy, componentes React reales con acciones diferidas sintéticas | 16/16 escenarios; desarrollo y producción de React | [hoy-browser-results.json](evidence/hoy-browser-results.json), [salida](evidence/hoy-browser-results.txt) |
| Creación de atención sin turno, modal real con acciones sintéticas | 14/14 escenarios; desarrollo y producción de React | [create-browser-results.json](evidence/create-browser-results.json), [salida](evidence/create-browser-results.txt) |
| Teclado, selección y diálogos | 18/18 escenarios tras el segundo ciclo; desarrollo y producción de React | [interaction-results.json](evidence/interaction-results.json), [salida](evidence/platform-interactions-after.txt) |
| Landing, acceso y estilos de impresión, servidor Next aislado en 4410 | Ronda inicial: 22/22; 0 fallos, omitidas o reintentos | [salida de la ronda inicial](evidence/public-e2e-results.txt) |
| Comparación visual de landing después de inspeccionar y generar los baselines nuevos | 10/10, segunda ejecución sin regenerar imágenes | [visual-landing-results.json](evidence/visual-landing-results.json), [comparación](evidence/visual-landing-compare.txt) |
| TypeScript global tras actualizar los specs | Salida 0 | [qa-typecheck.txt](evidence/qa-typecheck.txt), [qa-checks.json](evidence/qa-checks.json) |
| ESLint de los archivos de QA modificados | Salida 0, sin diagnósticos | [qa-lint.txt](evidence/qa-lint.txt), [qa-checks.json](evidence/qa-checks.json) |

Los archivos vacíos de TypeScript y ESLint indican ausencia de diagnósticos; sus códigos de salida se registran en `qa-checks.json`.

Integración final: `pnpm lint` global aprobado ([salida](evidence/lint-final.txt)); `pnpm test:build` aprobado con compilación, tipos y ESLint ([salida](evidence/build-final.txt)). Se corrigió la resolución de plugins de ESLint para que el build aislado no dependa de NODE_PATH; las reglas siguen activas. El build informa 223 kB en la columna First Load para `/`. No se interpreta como una medición de velocidad real.

La versión compilada se arrancó localmente y se inspeccionó en navegador: [captura](evidence/landing-production-local.png), pestaña Los cobros seleccionable y consola de esa visita sin errores/advertencias. [Smoke HTTP](evidence/production-smoke.json): 200 en portada, login, forgot e imagen OpenGraph; 404 en las tres galerías nuevas. [Trazas](evidence/opengraph-font-tracing.json) confirman que ambas imágenes OpenGraph incluyen sus dos fuentes TTF locales.

El build conserva advertencias de instrumentación Sentry/OpenTelemetry. Las lecturas de directorio registran que el backend sintético no responde; no se consultó Supabase real. El servidor arrancó y sirvió las rutas públicas comprobadas. Esto no verifica instrumentación, directorio conectado ni servicios externos en un despliegue real.

## Recorrido y alcance de la evidencia

- **Llegar:** doble clic despacha una sola solicitud; un refresco atrasado no revierte la llegada. Se impide abrir la ficha mientras esa transición está pendiente. Una cancelación recibida durante el envío se conserva después de una respuesta tardía.
- **Atender:** los controles reales permiten llegada → atención → cierre después de cada confirmación. La navegación por teclado del directorio abre una sola ficha; selección y agenda no disparan la navegación de la fila.
- **Guardar:** la suite unitaria de este checkout cubre transformación SOAP/borrador, versión esperada `updatedAtEsperado`, preservación de datos clínicos de otra herramienta, pertenencia turno-paciente-organización e historia. No demuestra una escritura en Postgres seguida de una nueva lectura. No se atribuye a este checkout la suite `clinical-save-actions` de otras ramas.
- **Cobrar:** se verifica el cierre aceptado con pago rechazado, la retirada del importe optimista y una única notificación de error. Un cobro más nuevo recibido del servidor sintético no es reemplazado por una respuesta anterior ni se anuncia una deuda falsa. Las acciones de cobro están sustituidas; no se realizó una transacción financiera.
- **Reabrir:** se verifican destinos de navegación y protecciones de borrador/historia cubiertas por las unidades. Reabrir en una sesión autenticada y recuperar de una base local real lo guardado continúa siendo una prueba de integración distinta. La galería `/dev/experience` no cuenta como evidencia de guardado.
- **Respuesta incierta al crear:** el formulario conserva el nombre ingresado, bloquea un duplicado y ofrece revisar la agenda original. Cambiar luego la fecha del formulario no altera la fecha y el profesional usados para recuperar el contexto. Una validación explícitamente rechazada sí permite corregir y volver a enviar.

## Accesibilidad e interfaz comprobadas

El fixture de interacciones importa `PacientesDir`, `StepShell` y `MobileNav` reales. Sustituye navegación, Next Image y componentes que disparan acciones, y utiliza un servidor HTTP efímero propio. Comprueba Enter en el nombre, Space en la selección, clic en su label, separación de Agendar, foco contenido/restaurado y Escape en la vista previa de onboarding y el menú móvil. Comprueba también que el rol ASISTENTE no obtiene acceso visual a Finanzas.

Los specs públicos comprueban CTA primario y recorrido secundario, enlaces legales públicos, contenido inicial del servidor, JSON-LD, sitemap, robots, FAQ por teclado, flechas/Home/End en las pestañas del producto, menú móvil y retorno de foco con Escape. El acceso comprueba ilustración estable y explícitamente ficticia, escritura conservada, mostrar/ocultar contraseña por teclado, apertura del registro sin envío, recuperación de acceso, variante del portal y ausencia de desbordamiento a 375 px. Las solicitudes de navegador se limitan al mismo origen y a GET/HEAD.

## Mantenimiento de pruebas

`side-art.spec.ts` dejó de exigir carrusel, autoplay, temporizadores y tintes que ya no forman parte del producto. La cobertura se sustituyó por las interacciones vigentes. `landing.spec.ts` conserva las comprobaciones públicas y de SEO, actualiza el contenido deliberadamente reemplazado y añade las pestañas accesibles y el cierre del menú móvil. El selector ambiguo de analítica `data-fl-cta="hero"` fue reemplazado por los nombres accesibles de ambas acciones, verificando sus dos destinos.

En `auth`, `onboarding`, `billing`, `demo-path`, `open-redirect` y `signup-consent-ratelimit` sólo se actualizaron selectores de títulos y acciones reemplazados. Se conservaron datos, condiciones, aserciones y escenarios. Estos seis specs **no se ejecutaron completos**: las suites de autenticación, onboarding y billing necesitan una sesión/base local real o pueden crear usuarios; este servidor usa endpoints sintéticos sin ese backend. No se presentan como aprobados.

Los baselines de `tests/visual/landing.spec.ts` se regeneraron para el DOM nuevo, se inspeccionaron con `view_image` y después pasaron una nueva comparación sin `--update-snapshots`. Se cubren hero desktop, producto, continuidad de atención, cuidado de información y hero móvil a 375 px, tanto con preferencia clara como oscura. Los cinco pares son idénticos por hash: la landing conserva deliberadamente su paleta clara independiente del tema del área de trabajo. [Hashes de los diez baselines](evidence/visual-baseline-hashes.json).

La primera captura del producto incluía la cabecera sticky superpuesta sobre el título. Se corrigió el procedimiento: sólo para capturar secciones se mantiene la cabecera en el flujo normal sin posición sticky; los screenshots de viewport mantienen la cabecera real. Se volvió a inspeccionar el producto con el título completo y se compararon los diez baselines. No se modificó la interfaz para ocultar este defecto de captura. Se eliminaron los dos antiguos baselines full-page: el spec usa viewport y secciones individuales, sin componer una página extensa.

Se agregó una prueba de `/forgot` con apertura, recarga, escritura sintética y observación de errores de consola/hidratación; no se envía el formulario. Las comprobaciones de impresión sólo emulan media print y leen estilos/DOM del fixture: la ficha individual marcada `data-printable` conserva papel blanco incluso con tema oscuro, sus controles se ocultan, y el cuerpo de Hoy con múltiples pacientes no se imprime. El alcance original de la barrera es `.fi-main > *`; no se atribuye esa protección a páginas públicas como `/login`. El modo impresión también desactiva las transiciones de pantalla para aplicar la paleta del papel inmediatamente. No se genera PDF ni un documento con datos reales. Resultado conjunto final: 12 pruebas de landing, 8 de acceso y 2 de impresión, todas aprobadas.

## Reproducción

Desde el worktree, sin cargar variables de producción:

```powershell
pnpm test:unit
node tests/hoy/run-isolated.mjs browser
node tests/hoy/run-isolated.mjs browser-create
node scripts/design-interactions-qa.mjs
```

Con el servidor de diseño ya iniciado mediante `node scripts/design-dev.mjs` en 4410:

```powershell
node --import ./scripts/testing/app-bootstrap.mjs node_modules/@playwright/test/cli.js test --config playwright.design.config.ts
node --import ./scripts/testing/app-bootstrap.mjs node_modules/@playwright/test/cli.js test --config playwright.design-visual.config.ts
node --import ./scripts/testing/app-bootstrap.mjs node_modules/typescript/bin/tsc --noEmit
```

Los configs de diseño rechazan un entorno sin aislamiento o una URL distinta de `http://127.0.0.1:4410` y no arrancan el servidor habitual. Uno selecciona landing, SideArt e impresión sintética; el otro sólo los screenshots de landing. Para ESLint debe usarse `pnpm exec eslint`: invocar su archivo interno directamente después de limpiar el entorno omite la resolución de plugins que prepara el gestor de paquetes.

No se cambiaron políticas RLS, contratos de acciones, migraciones, credenciales ni proveedores durante esta revisión. Las pruebas aisladas no certifican Auth, RLS, almacenamiento, correo, pagos, despliegue o producción.
