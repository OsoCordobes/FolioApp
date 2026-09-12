# Acceso, configuración inicial y entrada pública

Dirección: **Clínica clara**. Revisión local del 12 de septiembre de 2026, rama `codex/folio-experience`, servidor aislado `127.0.0.1:4410`.

## Cambios implementados

- Acceso, recuperación, confirmación de correo y portal comparten superficies claras, marca, tipografía local y campos grandes. El panel lateral es estático y rotula las personas como ficticias; la variante del portal habla al paciente.
- `/forgot` muestra la recuperación directamente. Los mensajes conservan el tratamiento que evita revelar la existencia de una cuenta. El restablecimiento presenta espera, enlace inválido y camino para pedir otro.
- La contraseña de login tiene una etiqueta independiente de sus botones. No se la marca inválida por tener menos de ocho caracteres: el acceso conserva la compatibilidad con contraseñas antiguas. Errores de recuperación y horarios están asociados a sus campos.
- El alta muestra ocho pasos con propósito, progreso, regreso y configuración posterior donde ya estaba permitida. El primer paso tiene un elemento `main`.
- Los servicios usan una grilla adaptable real; en móvil el nombre ocupa una fila y duración/precio/quitar la siguiente. Los días y botones de quitar tienen área táctil de al menos 44 px.
- La vista previa móvil usa diálogo nativo, ciclo explícito de Tab, Escape y restauración del foco. Su apertura está después del formulario, sin tapar campos.
- El cierre distingue espera, confirmación y error. El error con su reintento aparece antes de la tarjeta, también en móvil. La tarjeta final conserva `logoUrl` y `cardMood`; copiar tiene confirmación y una alternativa si falla el portapapeles.
- El directorio conserva enlaces, filtros y contenido públicos. Sus filtros tienen `aria-current`, las tarjetas tienen títulos y el vacío orienta primero al paciente. Se cambió el CTA que insinuaba gratuidad permanente por “Sumar mi consultorio”.
- La entrada de reservas explica servicio, contacto y estado de solicitud. Se retiraron las afirmaciones universales “Cada dato se cifra” y el sello legal de esa presentación; no se modificó ningún mecanismo de protección ni validación.

## Evidencia visual actual

Capturas en `docs/design/evidence/`. Escritorio principal: 1440 × 1000; móvil: 390 × 844. La captura de recuperación inválida en escritorio usa 1280 × 720. Son pantallas renderizadas de componentes reales con datos sintéticos.

| Recorrido | Evidencia |
| --- | --- |
| Login escritorio y móvil | `auth-login-desktop.png`, `auth-login-mobile.png` |
| Recuperar acceso escritorio y móvil | `auth-forgot-desktop.png`, `auth-forgot-mobile.png` |
| Alta inicial | `onboarding-start-desktop.png` |
| Perfil profesional, paso 2 | `onboarding-profile-desktop.png` |
| Consultorio, paso 3 | `onboarding-practice-mobile.png`; inspección adicional de escritorio |
| Identidad, paso 4 | `onboarding-identity-desktop.png`, `onboarding-identity-mobile.png` |
| Horarios, paso 5 | `onboarding-hours-desktop.png`, `onboarding-hours-invalid-mobile.png` |
| Servicios, paso 6 | `onboarding-services-desktop.png`, `onboarding-services-mobile.png` |
| Calendario, paso 7, sin conectar | `onboarding-calendar-desktop.png` |
| Cierre, paso 8 | `onboarding-finish-desktop.png`, `onboarding-finish-error-mobile.png`, `onboarding-finish-pending-mobile.png` |
| Vista previa móvil | `onboarding-preview-dialog-mobile.png` |
| Recuperación verificando/sin sesión válida | `auth-reset-verifying-mobile.png`, `auth-reset-invalid-mobile.png`, `auth-reset-invalid-desktop.png` |
| Portal con enlace expirado | `portal-login-expired-mobile.png` |
| Directorio con ejemplos y vacío | `directory-desktop.png`, `directory-mobile.png`, `directory-empty-desktop.png` |
| Reserva: servicio → profesional | `booking-professional-desktop.png` |

Las capturas de galería incluyen su selector y, en algunos casos, las herramientas locales de desarrollo. No son parte de la plataforma de producción.

## Interacciones comprobadas

- Franja 09:00–08:59: mensaje “El fin tiene que ser después del inicio”, `aria-invalid=true`, asociación con el mensaje y Continuar deshabilitado. La prueba se completó con teclado nativo; el llenado directo del control de hora no había producido el cambio de React.
- Diálogo: Tab permanece en su botón de cierre; Escape cierra y devuelve foco a “Ver mi perfil público”. Se verificó `dialog.contains(document.activeElement)` y restauración posterior.
- Elección de estilo Clínico: radio marcado y tarjeta del diálogo con `data-card-mood="clinico"`.
- En el ejemplo de cierre fallido y pendiente no se habilita entrar al panel.
- Directorio y pasos 3, 5 y 6 sin desbordamiento horizontal en 390 px.
- Reserva: elegir Consulta inicial presenta profesionales y enfoca el encabezado “Elegí profesional”. No se pidió un horario al servidor ni se envió una reserva.

## Entorno y comprobaciones

La galería `/dev/experience` sigue cercando solicitudes. Se extendió su selector hasta el paso 8. El paso final renderiza `Step9Moment` con callbacks vacíos y una etiqueta explícita de demostración, con estados `complete`, `pending` y `error`; no crea ni finaliza cuentas. El paso 7 dispara su efecto existente, rechazado por el cerco de la galería y explicado en pantalla.

`/dev/directory-preview` contiene tres consultorios ficticios, sin cuentas ni consultas de base de datos. Devuelve 404 en producción o sin `FOLIO_TEST_ISOLATED=1`. `?state=empty` permite inspeccionar el vacío. `/dev/book-preview` es la ruta de desarrollo preexistente.

- 46 pruebas unitarias existentes aprobadas: mapa de errores de autenticación, fuerza de contraseña, borrador, continuidad del alta, franjas y plantillas. Ejecutor aislado del repositorio.
- ESLint sobre los 19 TS/TSX del conjunto revisado: aprobado tras el último cambio.
- `git diff --check` del conjunto: aprobado.
- Typecheck aprobado en el control intermedio y en la repetición final posterior al directorio y los textos de reserva.

## Hallazgo resuelto en integración

`FolioMark/useId` presentaba una discrepancia de hidratación en `/forgot` incluso después de una recarga limpia (17:56:02 UTC). La integración sustituyó el recorte identificado por ID y la letra dependiente de una fuente por trazados SVG estables. La regresión de navegación y recarga de `/forgot`, con revisión de consola, pasó sin discrepancias de hidratación.

## Límites

Esta evidencia no prueba Auth, captcha, correo, OAuth de Google, subida de logos ni persistencia con servicios reales. No se aceptaron términos ni se crearon cuentas. No se accedió a datos reales ni se desplegó. Los estados finales son ejemplos de presentación, no confirmaciones de guardado. El éxito y error de conexión a Google Calendar, los estados de envío de correo y la reserva completa requieren pruebas aisladas específicas o un entorno de ensayo autorizado.
