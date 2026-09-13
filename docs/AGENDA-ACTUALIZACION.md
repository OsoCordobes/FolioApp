# Actualización de agenda sin ocultar fallos

M111 está implementada y revisada localmente. No está aplicada a producción.
La migración es aditiva y debe preceder al código que consulta el marcador.

## Comportamiento

Hoy y Calendario consultan un marcador pequeño cada 25 segundos mientras la
pestaña está visible. Sólo piden nuevamente la vista completa cuando ese marcador
cambia. Ocultar la pestaña cancela la consulta; volver a ella o recuperar conexión
comprueba el estado. Ante fallos se conserva la vista y se muestra un aviso con
reintento. La espera aumenta hasta dos minutos y cada consulta vence a los diez
segundos. La señal opcional de Realtime sólo adelanta una comprobación.

El marcador contiene la revisión de la organización y su fecha local. No depende
del reloj del navegador. Pasar la medianoche en Córdoba cambia el marcador aunque
nadie haya escrito un turno; otra zona de la organización se calcula por separado.

El servidor lee la revisión antes de cargar el contexto y los datos de la vista.
El cliente sólo confirma actualización cuando recibe esa revisión dentro de la
vista efectivamente renderizada: llamar a `router.refresh()` no prueba que haya
llegado una respuesta. Un fallo de permisos o de lectura no puede quedar oculto
por una confirmación tardía. Una restauración que reduzca el contador también
provoca recarga: se compara igualdad, no mayor/menor.

## Aislamiento y concurrencia

Los contadores privados cambian dentro de la misma transacción que modifica los
datos relevantes (turnos, pedidos, pagos, sesiones, horarios, identidad, servicios,
miembros, organización, perfiles o suscripción). Los cambios de perfil alcanzan
sólo las organizaciones vinculadas. Escritores simultáneos no pierden incrementos
y una lectura no observa cambios sin confirmar.

La consulta requiere organización, membresía y sesión/MFA vigentes. La ruta
revalida también acceso comercial al momento de leer y responde sin caché privada
compartida. El marcador no revela pacientes, contenido, nombres ni filas de otras
organizaciones.

## Evidencia y límites

Se verificaron 20 pruebas focales, ocho escenarios de navegador repetidos en
desarrollo/StrictMode y producción, pruebas SQL de permisos y medianoche, y dos
escritores simultáneos con observador. Las pruebas usaron datos sintéticos.
El helper reproducible es `scripts/testing/agenda-revision-concurrency.mjs`;
el navegador está en `tests/agenda/browser.cjs`.

Esto demuestra coherencia funcional en el entorno probado. No acredita la carga
de 50 profesionales ni sustituye el ensayo con Supabase Auth y Storage reales.
La paginación completa de las lecturas visibles se documenta por separado en
[Lecturas de agenda e historia](LECTURAS-AGENDA-HISTORIA.md).
