# Folio · coherencia visual

Pedido del titular del 30/09, posterior al cierre. Base publicada: `36d6c8f62c81e315862c11197413919b6ec83574`. Alcance: sistema compartido y su aplicación visible a la landing, acceso y miniweb; sin modificar reglas clínicas, permisos, pagos, proveedores ni bases.

**Estado final del 30/09:** [PR191 publicada en Folio](https://foliosalud.com/), revisión visual independiente y controles del candidato y master aprobados. Squash `6bfcaa13307fe6f52fac619368d082eeb685fe9a`, árbol idéntico al candidato final `7f9c202f`. Despliegue READY, ambos dominios y seis respuestas públicas comprobados por operador y contrastados por A. Los apartados siguientes conservan el plan y la secuencia de evidencia.

**Límite abierto:** dos ensayos previos de servicios fallaron; el ensayo completo instrumentado final aprobó en Solo/Clínica con revisión1 durable. La causa de los fracasos anteriores sigue sin confirmarse. Se corrigió el diagnóstico de la prueba, no el producto. Este seguimiento no se oculta ni se confunde con la entrega visual o el lanzamiento completo.

## Resultado y límites

Una presentación profesional y reconocible de Folio: jerarquía clara, demostraciones legibles, espacios y controles consistentes. Conservar la estructura completa de la landing que el titular prefirió, su contenido útil y la identidad clara/violeta. No repetir la propuesta corta rechazada ni sumar efectos decorativos para aparentar calidad.

Las imágenes aportadas son referencias críticas, no prohibiciones de colores, fuentes o componentes. Los precios se mantienen derivados de su fuente vigente; no inventar testimonios, certificaciones, cifras ni capacidades. Preservar enlaces, SEO, aviso de retorno de acceso, consentimiento analítico y comportamiento móvil.

## Paquetes

| Paquete | Responsable y por qué | Cierre verificable |
|---|---|---|
| Crítica de diseño + comprobación independiente | Agentes A y B, separados: distinguir problemas visibles de preferencias y residuos de código. | 3–5 prioridades con vista real/fuentes; detector interpretado, no aplicado ciegamente. |
| Reglas y aplicación | Un escritor principal aislado; segundo sólo con archivos sin superposición si aporta utilidad. | Tipografía, espacios, colores por función, controles y movimiento definidos en código; landing completa y superficies públicas alineadas. |
| Revisión final | Revisor independiente sobre el resultado concreto. | Móvil/escritorio, teclado, contraste, movimiento reducido, ausencia de desbordamiento, contenido/enlaces y controles pertinentes; corrección agrupada, sin pulido indefinido. |
| Entrega | Manager | Vista navegable, comparación y evidencia breve. Estado de publicación explícito; no confundir propuesta con aprobación del titular. |

## Referencias y criterio

- [Linear](https://linear.app/): presenta el producto mediante recorridos y muestras concretas. Tomar la relación explicación/demostración, no su apariencia oscura ni sus afirmaciones.
- [Plain](https://www.plain.com/): oferta y acción claras, seguidas por explicación estructurada del trabajo. Tomar continuidad narrativa, no su identidad ni sus efectos.
- [Heidi](https://www.heidihealth.com/): organiza la propuesta alrededor de momentos de la práctica clínica. No trasladar funcionalidades, testimonios o acreditaciones ajenas a Folio.
- [Ingeniería de diseño de Linear](https://linear.app/now/behind-the-latest-design-refresh): jerarquía por tarea y reducción de tratamientos que compiten entre sí. Aplicación a Folio: navegación discreta, acciones reconocibles y separación por relaciones reales.
- [Escala tipográfica de GOV.UK](https://design-system.service.gov.uk/styles/type-scale/): tamaños y alturas de línea consistentes y adaptables. Adoptar el principio de legibilidad, no copiar su marca ni su tipografía.
- [Movimiento reducido, web.dev](https://web.dev/articles/prefers-reduced-motion): mantener contenido y acciones disponibles con una variante de movimiento reducido.

Estas observaciones son criterios de composición, no una medición comparativa de rendimiento. La elección final debe servir a profesionales y pacientes de Folio.

## Evidencia

Evaluaciones y capturas: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/design-coherence/`. Escritor Sol 6.1 High en `C:/Users/amiun/.codex/worktrees/privacy-release/folio-app`, nueva rama `codex/design-coherence` desde `36d6c8f`, con dependencias propias y evidencia anterior preservada. La creación adicional de `folio-design-system` terminó después del escaneo del gestor; quedó sin uso, limpia en36d6 y sin dependencias, env ni evidencia. El gestor rechazó su archivo por estar protegida por una tarea fijada; se conserva, sin insistir ni borrar archivos.

Archivos propios: sistema CSS central, estilos de landing/acceso/onboarding/miniweb/editor/especialidades, importación del sistema y marca compartida de landing/acceso/onboarding. [PR191](https://github.com/OsoCordobes/FolioApp/pull/191), candidato `c49ec628749c635dcb85ccb441f5e53db2e5a887`, árbol `fca93dd2f20f4345fe78f8bc5c32b8c9ae6cbe62`, checkout limpio. Vista local `4460`, HTTP 200 comprobado, sin credenciales productivas.

Críticas independientes completas: `ASSESSMENT-A.md` y `assessment-b-report.md` en la carpeta de evidencia. Hallazgos convergentes: texto editorial de 12–13 px y miniaturas de 8–11 px; padding uniforme de 104 px; diferencias menores de marca y recetas de controles. B midió 4,35:1 en una nota de demo activa y enlace secundario móvil de 18 px de alto. No observó overflow. Detector inicial sin hallazgos: no equivale a aprobación visual.

Resultado revisado: cuerpo editorial de 16 px, nota de demo activa de 11/12 px, contraste de 5,06:1 y enlace secundario de 44 px. Tipografía, color, controles y marca tienen una fuente común; las superficies conservan su composición. No se acortó la landing ni se eliminaron secciones. Se definieron reglas duraderas en `DESIGN.md` y contexto del producto en `PRODUCT.md`.

Pruebas del escritor: tipos, lint y build aislado Turbopack aprobados. Runner: 12 pruebas funcionales y 14 capturas recalibradas intencionalmente; recalibrar no demuestra igualdad con el aspecto anterior. Revisión independiente `READONLY-REVIEW.md` con aceptación visual SHIP y sin P1/P2: diez vistas públicas en dos tamaños sin desbordamiento ni errores de página, teclado, contraste y movimiento reducido; muestra adicional de Hoy conserva los controles compactos. Capturas y mediciones en `finish-review/`. A contrastó 14/14 hashes de fuentes revisadas con el candidato y nueve archivos protegidos con la base. La revisión no acredita toda WCAG, todos los flujos clínicos ni el lanzamiento.

Publicación en curso, todavía no ejecutada: app 36746380978, SQL 36746381004 y Vercel aprobaron el primer candidato. `access-proof` 36746380991 falló al primer guardado de servicios después de registro y reanudación aprobados; su log original se conserva. No se encontró cambio funcional que explique el fallo y no se lo atribuye a infraestructura sin prueba.

Para obtener información nueva se agregó únicamente diagnóstico seguro a dos archivos de pruebas: +60 líneas, 23 casos sintéticos de parser/alerta/allowlist, tipos y lint aprobados; revisión independiente `publication/DIAGNOSTIC-REVIEW.md`. Nuevo candidato `4a14310b714ccfe01268642ec7d5ccd3b949da75`, árbol `726129ead3c0f53059356f83ad9a8f2c3b54ddfc`, publicado en la misma PR para una nueva ejecución instrumentada. La UI y sus capturas no cambiaron; su evidencia sigue vigente. No hubo reintento ciego del run anterior ni cambios de producto, base de datos, entorno o proveedores. El operador registra CI y publicación en `publication/RECEIPT.md`.

El ensayo instrumentado 36749520386 repitió el fallo en `initial_save`. Observó un POST con HTTP200/Result.ok pero no pudo atribuirlo a la acción de guardar servicios: DB sigue con cero servicios activos/revisión0 y hay una alerta fuera de las categorías reconocidas. Esto no demuestra guardado correcto ni causa de infraestructura. Publicación retenida; lectura causal independiente sobre validación/autosave/orden de acciones antes de otra ejecución. No se considera un defecto de producto explicado sólo por repetirse el fallo de la prueba.

Vista de revisión externa del candidato 4a14310b: https://folio-3zmphdujz-osocordobes-projects.vercel.app, READY/gru1 y SHA/proyecto confirmados por API. GET anónimo200, sin cambiar protección. A abrió la portada y comprobó su presentación. Es Preview, no publicación en foliosalud.com.

La lectura independiente detectó un defecto del diagnóstico: el selector mezclaba el mensaje de `SaveIndicator` con el botón «Reintentar guardar». No explica el guardado. Se corrigió sólo spec/runner (+12/−8): mensaje propio, categoría cerrada `prepare_storage` y revisión numérica segura. El fixture con markup real reproduce el error del selector anterior y aprueba el nuevo; canarios, tipos y lint aprobados. Revisión independiente `publication/DIAGNOSTIC-V2-REVIEW.md`. Candidato `7f9c202f478bc0ece0c75507e4cfeff1c6bad4d8`, árbol `592bd7704f81f21adf4e356a0b333b8bbc45f67e`; siguiente CI automática será la única ejecución adicional autorizada para distinguir fallo local previo al envío de rechazo del guardado. No hay cambio visual ni de producto; no se asume una causa todavía.

Cuota compartida: al cerrar la revisión visual, 61% usada; al corregir el diagnóstico, 65%; al finalizar la publicación, 67% usada/33% disponible. Saldo 62497,459246 y un reset sin cambios; estas lecturas no permiten atribuir consumo por agente.

## Cierre y continuación

La publicación quedó comprobada: CI del candidato app36752567695/access36752567750/SQL36752567740 y CI de master app36753991091/SQL36753991083 aprobados. Deployment Git `dpl_HUyjEygoESW6iLe4jCo6bVoPx23o`, READY/gru1/SHA exacto, canónico y www confirmados. A abrió la portada publicada y contrastó los originales: 94/94 hashes de evidencia coinciden. Recibo `publication/RECEIPT.md`, SHA256 `E481D071B51A9E920A59777FB29F903D20555838D539A61E631B083BF94C2472`.

Se cierra esta pasada sin nuevas implementaciones ni automatización reactivada. Para revisión humana: portada en móvil/escritorio, pestañas del producto, especialidades e ingreso. En el siguiente ciclo, separar el seguimiento de los dos ensayos de servicios sin causa confirmada de los pendientes de lanzamiento ya registrados; no repetir publicación, migraciones ni pruebas aprobadas por rutina.
