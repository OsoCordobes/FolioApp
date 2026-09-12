# Pulido de acceso, onboarding y reserva

Revisión local del 12 de septiembre de 2026, posterior a `8f1a6d5`. Dirección visual: **Clínica clara**. Cambios contenidos en las pantallas y componentes de acceso público; sin cambios de contratos de servidor, proveedores, base de datos o producción.

## Hallazgos y cambios

| Hallazgo comprobado | Resultado |
| --- | --- |
| Enter sobre Provincia avanzaba del paso 3 al 4 del onboarding. | Los selectores nativos y los campos de fecha/hora conservan Enter y Escape. La navegación sigue funcionando desde campos de texto y desde los botones. |
| El listener global también podía recibir teclas de un control externo o ya manejadas por otro componente. | Los atajos se limitan al asistente y respetan composición de texto, repetición de teclas y eventos consumidos. El autofocus omite campos de solo lectura y deshabilitados. |
| En recuperación, enviar un campo vacío no mostraba una explicación ni devolvía el foco. | Mensaje visible en español, relación accesible con el campo, estado inválido y foco en el email. El aviso se limpia al editar. |
| Al pasar de acceso a recuperación y volver se perdía el email escrito. | El email se conserva durante ese recorrido. No se guarda la contraseña ni se agrega almacenamiento persistente. |
| El email de recuperación seguía editable mientras se enviaba. | Se deshabilita junto al envío mientras la acción está pendiente; la confirmación conserva la dirección enviada y recibe el foco. El mensaje mantiene la respuesta que no revela si existe la cuenta. |
| En el portal, el error de email carecía de estado visual/accesible del campo. | El error de validación marca el campo y le devuelve el foco. Un enlace vencido se informa sin marcar el email como incorrecto. La pantalla de confirmación recibe el foco. |
| El estado de reenvío incluía una cuenta atrás dentro de la región anunciada. | El estado anuncia «Enlace reenviado»; el temporizador permanece visible y consultable, con los anuncios automáticos desactivados. El cooldown y su persistencia se conservan. |
| El ojo de contraseña medía 42 px y recuperación 27 px de alto. Volver en reserva medía 40 px. | Esos controles tienen un área de toque mínima de 44 px y conservan una indicación de foco visible. |
| En móvil, «Reservar turno» seguía fijado abajo mientras el usuario ya elegía profesional. | La acción fija se retira mientras el formulario está visible. Al activarla, el foco entra en el paso actual. Observar todo el hero permite detectar también los saltos directos de navegación. |
| La prueba de movimiento reducido detectó una transición heredada de 120 ms en el envío. | La preferencia desactiva transiciones y animaciones de acceso/onboarding, y de las superficies públicas, incluidos pseudo-elementos. |

## Verificación

- **16/16 regresiones de interacción**, en compilaciones React de desarrollo y producción, mediante `node scripts/design-access-qa.mjs`.
- **46/46 pruebas unitarias pertinentes**: errores de Auth, fuerza de contraseña, borrador y reanudación del onboarding, horarios y plantillas.
- **Typecheck y ESLint de los archivos modificados: correctos.**
- Revisión sobre el servidor local aislado `127.0.0.1:4410` en **1440 × 1000** y **390 × 844**. Sin errores de consola en la revisión final.
- Se volvió a comprobar en la pantalla real que Enter y Escape sobre Provincia mantienen el paso 3. El diálogo móvil mantiene Tab dentro, se cierra con Escape y devuelve el foco a su apertura.
- La reserva local confirmó que la acción fija se retira al entrar al formulario, que el foco pasa a «Elegí el servicio» y luego a «Elegí profesional», y que volver mide 44 px. No hay desbordamiento horizontal a 390 px.
- Movimiento reducido comprobado con emulación explícita en el arnés aislado: duración de transición de envío `0s`, foco visible y controles de 44 px en ambos tamaños.

El arnés monta los componentes reales con acciones sintéticas, una dirección `example.invalid`, red limitada a su propio servidor loopback y entorno saneado. Sus modalidades `development` y `production` son compilaciones de esos componentes, **no un build completo de Next ni una verificación de despliegue**. No envió emails ni reservas reales. No verifica Auth, captcha, disponibilidad, confirmación o persistencia reales. La confirmación de envío y el temporizador se comprobaron en ese arnés; los primeros pasos de reserva se comprobaron además en la aplicación local.

## Evidencia

Pantallas de la aplicación local:

- [Acceso en escritorio](evidence/polish-access-login-desktop.png)
- [Acceso móvil con foco visible](evidence/polish-access-login-mobile-focus.png)
- [Recuperación: validación y foco en móvil](evidence/polish-access-forgot-mobile.png)
- [Portal: validación en móvil](evidence/polish-access-portal-validation-mobile.png)
- [Onboarding: diálogo móvil](evidence/polish-access-onboarding-dialog-mobile.png)
- [Reserva móvil antes](evidence/polish-access-booking-mobile-before.png) y [después](evidence/polish-access-booking-mobile-after.png)

Estados del arnés aislado, usando el componente real y la tipografía local:

- [Envío de recuperación pendiente](evidence/polish-access-recovery-pending.png)
- [Confirmación de recuperación](evidence/polish-access-recovery-success.png)
- [Temporizador de reenvío](evidence/polish-access-confirmation-timer.png)
- [Movimiento reducido a 390 px](evidence/polish-access-reduced-390.png) y [1440 px](evidence/polish-access-reduced-1440.png)
- [Resultados de las 16 regresiones](evidence/polish-access-results.json)

## Archivos de implementación

`components/auth/login-form.tsx`, `components/auth/check-email-panel.tsx`, `components/onboarding/step-shell.tsx`, `app/(portal)/portal/login/login-form.tsx`, `components/book-landing/sticky-book-cta.tsx`, `styles/auth-experience.css`, `styles/public-experience.css` y `scripts/design-access-qa.mjs`.

No se modificaron las acciones de reserva o acceso, el captcha, los consentimientos, la finalización del onboarding ni sus mecanismos de recuperación. El servidor de desarrollo quedó en funcionamiento y el tamaño de navegador volvió a su valor normal. No se crearon commits en esta ronda.
