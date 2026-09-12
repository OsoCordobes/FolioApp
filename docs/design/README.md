# Folio · Clínica clara

Reconstrucción y pulido en `codex/folio-experience`, dentro de una copia separada del proyecto. La ronda original partió de `2dae580`; la ronda de pulido del 12 de septiembre de 2026 continúa desde `8f1a6d5`. No se publicó ni se modificó la base de datos.

## Ronda actual: pulido y adaptación de pantalla

La estética aprobada se conserva. La portada aprovecha monitores amplios, el recorrido mantiene su altura al cambiar de vista y cada especialidad tiene una ficha ilustrativa propia. La marca Hoja clara se unifica en cabecera, favicon e imagen para compartir. En la plataforma se mejoran selección, filtros, foco de teclado, diálogos y controles en ventanas bajas; los textos explican las acciones sin jerga interna.

Empezar por el **[índice de verificación de esta ronda](POLISH-VERIFICATION.md)**: resultados por módulo, evidencia, límites y comprobaciones finales pendientes. El [registro de decisiones](POLISH-LOG.md) conserva la secuencia de iteración.

- **Pantallas y lectura:** [portada amplia y reflujo](POLISH-RESPONSIVE.md), [plataforma en monitores amplios](POLISH-WIDE-PLATFORM.md), [ventanas bajas](POLISH-SHORT-VIEWPORT.md).
- **Interacciones:** [cinco fichas clínicas](POLISH-CLINICAL.md), [plataforma](POLISH-PLATFORM.md), [diálogos y guardas pendientes](POLISH-MODAL-FOCUS.md), [sección activa al recorrer la portada](POLISH-SCROLLSPY.md).
- **Acceso y comunicación:** [acceso y alta](POLISH-ACCESS.md), [portal e invitaciones](POLISH-PORTAL.md), [avisos y errores](POLISH-STATES.md), [textos claros](POLISH-COPY.md).
- **Marca y revisión independiente:** [imagen para compartir](POLISH-BRAND-OG.md), [revisión cruzada, carga y contraste](POLISH-CROSS-REVIEW.md), [revisión cruzada de plataforma](POLISH-REVIEW-PLATFORM.md).

Muestras recientes inspeccionadas: [Psicología](evidence/polish-specialty-psychology-desktop-final.png), [Cardiología](evidence/polish-specialty-cardiology-desktop-final.png), [ficha móvil](evidence/polish-specialty-mobile-final.png), [Pacientes a 2560 px](evidence/wide-pacientes-2560-after.png), [Finanzas a 2560 px](evidence/wide-finanzas-2560-after.png), [foco móvil](evidence/contrast-focus-tour-light-390.png) e [imagen para compartir](evidence/polish-marketing-opengraph.png).

## Recorrer el resultado

- [Folio en vivo](http://127.0.0.1:4410/): portada completa y acceso real a las rutas públicas.
- [Pantallas internas](http://127.0.0.1:4410/dev/experience): agenda, pacientes, cinco fichas, finanzas, configuración, alta y portal con datos ficticios. El selector superior cambia de pantalla. Las escrituras están bloqueadas explícitamente.
- [Directorio](http://127.0.0.1:4410/dev/directory-preview), [reserva](http://127.0.0.1:4410/dev/book-preview) e [invitaciones](http://127.0.0.1:4410/dev/invitation-preview): vistas locales para inspección.
- [Estudio de la marca](http://127.0.0.1:4410/dev/brand-studies): evolución del símbolo y tamaños pequeños.
- [Tres direcciones exploradas](http://127.0.0.1:4410/dev/design-directions.html): Clínica clara, Archivo vivo y Centro de práctica.

La implementación de las pantallas es la misma que usa la aplicación. Las galerías aportan datos sintéticos sin iniciar sesiones ni simular confirmaciones de guardado real. El servidor puede cambiar temporalmente a modo compilado durante la integración, donde las cinco galerías nuevas verificadas quedan ocultas; el alcance exacto está documentado abajo.

## Ronda original del rediseño

La portada muestra el consultorio primero y continúa desde la agenda hacia la historia y los cobros. La nueva tipografía, los estados y el espaciado se extienden al acceso, alta del consultorio, agenda, pacientes, fichas de las cinco especialidades, finanzas, configuración, reservas, directorio y portal. Se conservan los contratos del servidor y las capacidades reales.

La revisión en navegador produjo correcciones concretas: columnas clínicas y notas, controles móviles de servicios, selección accesible del mapa de quiropraxia, etiquetas de configuración, búsqueda financiera, manejo del foco, fidelidad de la tarjeta al finalizar el alta y geometría estable de la marca. Los textos de marketing y reserva describen lo que el producto implementa.

## Evidencia de la ronda original

- [Portada escritorio](evidence/landing-desktop-final.png), [portada móvil](evidence/landing-mobile-final.png), [recorrido móvil](evidence/landing-tour-mobile-final.png).
- [Acceso](evidence/auth-login-desktop.png), [servicios móviles](evidence/onboarding-services-mobile.png), [final del alta con error](evidence/onboarding-finish-error-mobile.png).
- [Cardiología](evidence/clinical-cardiologia-desktop.png), [psicología](evidence/clinical-psicologia-desktop.png), [kinesiología](evidence/clinical-kinesiologia-desktop.png), [nutrición](evidence/clinical-nutricion-desktop.png), [quiropraxia móvil](evidence/clinical-quiropraxia-mobile.png).
- [Directorio móvil](evidence/directory-mobile.png), [selección de profesional en reserva](evidence/booking-professional-desktop.png), [imagen para compartir](evidence/marketing-opengraph.png).
- [Pruebas y límites](VERIFICATION.md), [revisión clínica](CLINICAL.md), [acceso y alta](AUTH.md), [decisiones e iteraciones](EXPERIENCE-LOG.md), [referencias estudiadas](REFERENCES.md).

En esa ronda, la fuente de navegador pasó de 176.288 a 27.348 bytes. Retirar el carrusel obsoleto redujo 152.947 bytes de CSS fuente; su comparación gzip pasó de 119.466 a 99.590 bytes. Son mediciones históricas de recursos, no una promesa de velocidad. La comparación de bundles y el estado de la integración reciente están en el índice de pulido.

## Ejecutar localmente

`node scripts/design-dev.mjs` inicia la vista en 4410 sin cargar `.env`, usando la política de aislamiento existente. `pnpm test:build` compila con la misma protección; `node scripts/design-dev.mjs --production` permite comprobar esa compilación local.

En el checkpoint compilado de esta ronda, respondieron 404 las cinco galerías nuevas comprobadas: `/dev/experience`, `/dev/directory-preview`, `/dev/design-directions.html`, `/dev/brand-studies` y `/dev/invitation-preview`. [Evidencia HTTP](evidence/polish-production-smoke.json). Esa comprobación no incluye la ruta heredada `/dev/book-preview`.

Las pruebas locales no certifican Supabase, correo, OAuth, pagos ni guardado y reapertura con datos reales. La reserva se recorrió hasta seleccionar profesional. Antes de publicar corresponde verificar esos recorridos en un entorno de ensayo conectado.
