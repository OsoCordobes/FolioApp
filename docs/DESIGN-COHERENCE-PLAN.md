# Folio · coherencia visual

Pedido del titular del 30/09, posterior al cierre. Base publicada: `36d6c8f62c81e315862c11197413919b6ec83574`. Alcance: sistema compartido y su aplicación visible a la landing, acceso y miniweb; sin modificar reglas clínicas, permisos, pagos, proveedores ni bases.

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

Publicación en curso, todavía no ejecutada: SQL y Vercel aprobados; `access-proof` 36746380991 falló y se diagnostica con su log original antes de decidir cualquier reintento. App CI 36746380978 continúa. No hay cambios de base de datos, entorno ni proveedores. Cuota compartida al cerrar la revisión: 61% usada, 39% disponible, saldo 62497,459246 y un reset; no es consumo por agente.
