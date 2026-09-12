# Textos claros en la plataforma

12 de septiembre de 2026. Cambios de texto autorizados en el worktree `folio-experience`, sin alterar acciones, contratos, validaciones ni manejo de errores.

- **Alta de paciente:** se reemplazaron las referencias a DB, SHA-256 e índices internos por instrucciones útiles: formato del DNI, mínimo de teléfono, cobertura particular y qué determina las preguntas adicionales. Se conserva «Se guarda cifrado», respaldado por `encryptColumn` en `lib/db/pacientes.ts`.
- **Antecedentes por especialidad:** se aclara que pertenecen al paciente y se guardan cifrados. `lib/db/paciente-intake.ts` cifra el contenido antes de escribirlo. La ausencia de campos ahora se expresa como «Esta especialidad no tiene preguntas adicionales».
- **Navegación:** el estado sin enlace público dice «Todavía no configuraste tu enlace público», evitando el término interno «slug».
- **Configuración:** la descripción de acceso a datos dice «Descargá tus datos personales en un archivo JSON o solicitá la baja de tu cuenta para revisión humana». Se conserva JSON porque identifica el formato que se descarga. Se elimina la promesa de exportar «todo» y el plazo de 30 días no respaldado por el flujo actual.

La acción de baja devuelve `manual_review_required`; la tarea de revisión funciona en modo `review-only`, con `automatic_purge: false`. El texto describe esa revisión humana, sin prometer una eliminación automática ni un plazo. La exportación personal no incluye las historias clínicas de los pacientes. No se editaron textos legales.

Los textos de diagnóstico/notas del plan y de número de afiliado en el diálogo de cobertura se coordinaron con sus respectivos autores para no pisar cambios de foco o guardas pendientes. Su integración corresponde a esos autores.

Se normalizaron espacios alrededor de porcentajes, dimensiones y cantidades en `POLISH-PLATFORM.md`, `POLISH-CROSS-REVIEW.md` y `POLISH-WIDE-PLATFORM.md`, conservando identificadores y rutas de archivos.

ESLint de los cuatro componentes editados y typecheck global finalizaron con salida 0. Al tratarse de texto, no se repitió la suite de unidades ni el build. Fuente congelada tras esta revisión.
