# Portal, directorio e invitaciones

Ronda local del 12 de septiembre de 2026. Conserva la dirección Clínica clara. Las modificaciones afectan presentación y estado local; no cambian acciones de servidor, permisos, captcha, consentimientos, cuentas o base de datos.

## Cuatro hallazgos tratados

1. **La pestaña activa podía quedar recortada en móvil.** La navegación desplaza únicamente su fila horizontal para mostrar el enlace activo. También se adapta al cargar la tipografía y al cambiar de ancho. `aria-current="page"` se calcula desde la ruta real; la galería pasa una ruta explícita para presentar el mismo resultado sin cambiar el historial del navegador.
2. **Los vacíos explicaban qué hacer sin ofrecer el enlace.** Mis datos incluye «Ir al inicio del portal»; Resumen, «Ver mis turnos»; Turnos, «Buscar un consultorio». Los títulos de estos estados son encabezados semánticos. Se conserva el contenido clínico limitado del resumen.
3. **El cambio de horario no identificaba su panel abierto y perdía el foco al desaparecer.** El botón expone el estado abierto y su formulario; el contexto identifica el turno. Elegir manualmente otro horario enfoca el campo nuevo. Tras una solicitud exitosa, el foco regresa al botón cuando termina su estado pendiente. Los fallos retienen la fecha y el motivo. Los formularios del portal exponen su estado pendiente y las tarjetas de contacto identifican el consultorio. Campos móviles de 16 px, controles de al menos 44 px e indicación de foco clara.
4. **Invitación usaba un encabezado secundario sin principal y la misma validación de contraseña para alta y acceso.** Ahora tiene un `h1`, controles y tipografía consistentes con acceso, errores anunciados y relacionados con sus campos. Crear cuenta mantiene el mínimo de ocho caracteres; entrar requiere una contraseña no vacía y deja la comprobación de credenciales a la acción existente, igual que el login principal. Se conserva el email y la contraseña durante un error y reintento, sin añadir persistencia.

En el directorio no se necesitó rehacer las tarjetas ni filtros: conservan sus enlaces reales de reserva y especialidad. Se reforzó la indicación de foco para navegación por teclado.

## Verificación

- `node scripts/design-portal-qa.mjs`: **16/16 casos**, ocho recorridos en compilaciones React de desarrollo y producción.
- **49/49 pruebas unitarias** de invitaciones, reglas de turnos del portal, campos de perfil permitidos y enlaces de reserva.
- **ESLint de los archivos modificados y revisión de tipos: correctos.** El build integrado intermedio también pasó tipos, lint y doce rutas HTTP; evidencia en `evidence/polish-build-first.txt` y `evidence/polish-production-smoke.json`. Es un checkpoint: los cambios posteriores de responsive y marca se verifican en el siguiente build coordinado por la tarea principal.
- Pruebas del arnés: navegación activa desde la ruta de producción, cambio manual de horario, fallo/reintento con el mismo payload, foco tras éxito, contacto retenido tras fallo, autocomplete correcto de alta y acceso, contraseña corta admitida únicamente en login, seis estados de invitación, bloqueo de acciones en la muestra y enlaces del directorio.
- El arnés usa **390 × 844** y **1440 × 1000**, la tipografía local y movimiento reducido. Monta componentes reales con datos ficticios y acciones simuladas. No conecta Auth, disponibilidad, correos o persistencia reales y no representa un build de Next.

La primera revisión se hizo en `127.0.0.1:4410`. La navegación móvil corregida también se observó allí: «Mis datos» tenía `aria-current="page"` y su borde derecho quedó en 379,7 px dentro de un viewport de 390 px. La captura final de esa pantalla procede del arnés: se descartó una captura incoherente producida cuando otras revisiones compartieron el tamaño del navegador. Las capturas del arnés se abrieron e inspeccionaron después de generarse.

## Evidencia

Antes, en la aplicación local: [perfil vacío](evidence/polish-portal-profile-empty-before.png) e [invitación](evidence/polish-portal-invitation-before.png).

Después, componentes reales con acciones sintéticas:

- [Mis datos vacío y pestaña activa completa](evidence/polish-portal-profile-empty-mobile.png)
- [Cambio de horario con datos retenidos tras fallo](evidence/polish-portal-reagenda-mobile.png)
- [Contacto con foco y datos retenidos](evidence/polish-portal-profile-mobile.png)
- [Acceso de invitación con error](evidence/polish-portal-invitation-login-mobile.png)
- [Invitación pendiente en escritorio](evidence/polish-portal-invitation-desktop.png)
- [Directorio y foco de tarjeta](evidence/polish-portal-directory-mobile.png)
- [Resumen vacío](evidence/polish-portal-summary-empty-mobile.png)
- [Resultados completos](evidence/polish-portal-results.json)

La nueva ruta `/dev/invitation-preview` permite revisar muestras de acceso, pendiente, vencida, revocada, aceptada, email diferente y no encontrada. Solo existe en desarrollo aislado; sus envíos, aceptación y cambio de cuenta están bloqueados, también comprobados por el arnés.

## Archivos

Presentación del portal: `app/(portal)/portal/(tabs)/portal-nav.tsx`, `turnos/turnos-list.tsx`, `perfil/perfil-list.tsx` y `resumen/resumen-view.tsx`.

Invitación: `app/(public)/invitacion/[token]/invitation-client.tsx`. Estilos: `styles/public-experience.css`. Evidencia reproducible: `scripts/design-portal-qa.mjs`. Galería: cambio puntual de `PortalNav` en `app/dev/experience/preview.tsx` y nueva muestra en `app/dev/invitation-preview/`.

No se realizaron cancelaciones, solicitudes de turno, cambios de contacto, altas o aceptaciones reales. No se reinició el servidor ni se generaron commits desde esta ronda.
