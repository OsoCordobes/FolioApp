# Acceso y configuración inicial

Dirección: **Clínica clara**. Identidad compartida con el resto de Folio: fondo lavanda tenue, superficies blancas, tinta púrpura, acento violeta y Plus Jakarta Sans local.

## Qué cambió

- El panel lateral del acceso muestra una agenda ilustrativa estable. La tipografía y el día de trabajo dan contexto sin rotación automática, carrusel ni promesas publicitarias. Todas las personas y datos están rotulados como ficticios.
- Los formularios tienen un regreso al inicio a través del logo, título contextual, explicación breve, campos de 48 px y foco visible. El mensaje de error del acceso se anuncia y queda asociado a los campos.
- Los estados de envío conservan sus botones deshabilitados y sus mensajes. El texto de recuperación no confirma la existencia de una cuenta.
- La confirmación de email tiene una jerarquía propia y conserva el reenvío, los límites de frecuencia y la recuperación del tiempo de espera.
- Cada paso de configuración muestra la posición y su propósito. Los campos usan nombres cotidianos: perfil público, horarios disponibles, calendario y duración del turno.
- La vista previa móvil del perfil usa un diálogo nativo: contiene el foco mientras está abierto, admite Escape y permite regresar al formulario. El botón de apertura forma parte del documento para evitar tapar campos y acciones.
- Horarios y servicios tienen nombres accesibles para sus campos de hora, duración y precio.

## Archivos

- `styles/auth-experience.css`: estilos delimitados con `fx-auth-*`, `fx-onboarding` y `fx-onb-shell`. Cargar después de la base visual.
- `components/auth/side-art.tsx`: composición estática; conserva `SideArt`, `LazyMotion` y `domMax`.
- `components/auth/login-form.tsx` y `check-email-panel.tsx`: presentación de formularios y mensajes.
- `components/onboarding/onboarding-app.tsx`: clases y enlaces de marca del contenedor.
- `components/onboarding/step-shell.tsx`: progreso, acciones y vista previa.
- `components/onboarding/steps.tsx`: textos y nombres accesibles.

## Límites deliberados

No se cambiaron acciones de servidor, rutas OAuth, consentimiento, captcha, validaciones, datos iniciales, persistencia, borradores ni reglas de reintento. El diálogo de vista previa es el único comportamiento de interfaz reconstruido. Los estilos de una tarjeta pública elegida por un profesional se conservan.

El panel lateral también se utiliza en el portal de pacientes: el cambio conserva su contrato pero ese contexto requiere revisión visual antes de integrar. Las ilustraciones son figuras sin controles simulados.

## Verificación

- `pnpm typecheck`: aprobado.
- ESLint sobre los seis TSX modificados: aprobado.
- 46 pruebas existentes de errores de autenticación, fuerza de contraseña, borradores, continuidad de configuración, horarios y plantillas: aprobadas, mediante el ejecutor aislado del repositorio.
- `git diff --check` en los componentes modificados: aprobado.
- La inspección visual de acceso y configuración se completa una vez que el contenedor principal carga la nueva hoja de estilo.

Estas verificaciones locales no prueban autenticación, captcha, email ni guardado con servicios reales.
