# Alcance de clinical-experience.css

Análisis read-only del 12/09/2026. **Decisión: mantener el import global.** No se cambiaron fuente, imports, configuración ni arquitectura; no se atribuye ahorro de red o rendimiento.

El fichero pesa **11.928 bytes**, **3.212 bytes gzip** y 2.707 bytes Brotli, comprimido por separado y sin minificar. Estos tamaños no equivalen al ahorro de un asset agrupado.

La dependencia concreta es su bloque final de impresión: redefine la paleta global después del tema de pantalla. Al retirarlo, la impresión de `.fx-auth-art` cambia de fondo blanco/texto `#111111` a `#F5F5FA`/`#292641`; `.pt-empty` cambia de blanco a `#F0EFF8`. Se verificó con los estilos reales y DOM sintético. Mover sólo el import alteraría acceso y portal aunque sus pantallas no usen estilos clínicos.

La protección de Hoy sigue en `public/folio.css`: oculta `.fi-main > *` salvo `[data-printable]`. El fichero clínico no habilita su impresión. Si se reconsiderase la carga por rutas, habría que mantener global el bloque print (492 bytes, 293 gzip aislado) y cubrir también `/dev/quiro-ficha`, además de `(app)` y `/dev/experience`.

La cascada con clinical después de auth/public dio **12 comparaciones sin diferencias** en ficha, Hoy y quiropraxia legacy, a 390/1440 y pantalla/impresión. Es evidencia parcial de compatibilidad; no prueba el orden de assets emitido por Next. La ficha legacy de marketing no está importada por las rutas actuales, y los modales del portal usan `pc-consent-*` de `folio.css`, no las reglas clínicas de pantalla.

Preservar la impresión pública evita ampliar arquitectura por una ganancia pequeña y todavía no medida en un build comparativo. El checkpoint actual puede continuar sin cambios.

Evidencia: `evidence/clinical-css-cascade-review.json` y `evidence/clinical-css-print-dependency.json`.
