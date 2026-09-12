# Folio · Clínica clara

Reconstrucción implementada en `codex/folio-experience`, desde `2dae580`, en una copia separada del proyecto. No se publicó ni se modificó la base de datos.

## Recorrer el resultado

- [Folio en vivo](http://127.0.0.1:4410/): portada completa y acceso real a las rutas públicas.
- [Pantallas internas](http://127.0.0.1:4410/dev/experience): agenda, pacientes, cinco fichas, finanzas, configuración, alta y portal con datos ficticios. El selector superior cambia de pantalla. Las escrituras están bloqueadas explícitamente.
- [Directorio](http://127.0.0.1:4410/dev/directory-preview) y [reserva](http://127.0.0.1:4410/dev/book-preview): vistas locales para inspección.
- [Tres direcciones exploradas](http://127.0.0.1:4410/dev/design-directions.html): Clínica clara, Archivo vivo y Centro de práctica.

La implementación de las pantallas es la misma que usa la aplicación. Las galerías aportan datos sintéticos sin iniciar sesiones ni simular confirmaciones de guardado. Sólo están disponibles en desarrollo aislado.

## Qué cambió

La portada muestra el consultorio primero y continúa desde la agenda hacia la historia y los cobros. La nueva tipografía, los estados y el espaciado se extienden al acceso, alta del consultorio, agenda, pacientes, fichas de las cinco especialidades, finanzas, configuración, reservas, directorio y portal. Se conservan los contratos del servidor y las capacidades reales.

La revisión en navegador produjo correcciones concretas: columnas clínicas y notas, controles móviles de servicios, selección accesible del mapa de quiropraxia, etiquetas de configuración, búsqueda financiera, manejo del foco, fidelidad de la tarjeta al finalizar el alta y geometría estable de la marca. Los textos de marketing y reserva describen lo que el producto implementa.

## Evidencia

- [Portada escritorio](evidence/landing-desktop-final.png), [portada móvil](evidence/landing-mobile-final.png), [recorrido móvil](evidence/landing-tour-mobile-final.png).
- [Acceso](evidence/auth-login-desktop.png), [servicios móviles](evidence/onboarding-services-mobile.png), [final del alta con error](evidence/onboarding-finish-error-mobile.png).
- [Cardiología](evidence/clinical-cardiologia-desktop.png), [psicología](evidence/clinical-psicologia-desktop.png), [kinesiología](evidence/clinical-kinesiologia-desktop.png), [nutrición](evidence/clinical-nutricion-desktop.png), [quiropraxia móvil](evidence/clinical-quiropraxia-mobile.png).
- [Directorio móvil](evidence/directory-mobile.png), [reserva](evidence/booking-desktop.png), [imagen para compartir](evidence/marketing-opengraph.png).
- [Pruebas y límites](VERIFICATION.md), [revisión clínica](CLINICAL.md), [acceso y alta](AUTH.md), [decisiones e iteraciones](EXPERIENCE-LOG.md), [referencias estudiadas](REFERENCES.md).

La fuente que descarga el navegador pesa 27.348 bytes, frente a los 176.288 del primer archivo local. Retirar el carrusel obsoleto redujo 152.947 bytes de CSS fuente; la comparación gzip pasó de 119.466 a 99.590 bytes. Son mediciones de recursos, no una promesa de velocidad para usuarios reales.

## Ejecutar localmente

`node scripts/design-dev.mjs` inicia la vista en 4410 sin cargar `.env`, usando la política de aislamiento existente. `pnpm test:build` compila con la misma protección; `node scripts/design-dev.mjs --production` permite comprobar esa compilación local (las galerías responden 404 en ese modo).

Las pruebas locales no certifican Supabase, correo, OAuth, pagos ni guardado y reapertura con datos reales. La reserva se recorrió hasta seleccionar profesional. Antes de publicar corresponde verificar esos recorridos en un entorno de ensayo conectado.
