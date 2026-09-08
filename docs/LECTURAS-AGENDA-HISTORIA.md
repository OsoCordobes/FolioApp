# Lecturas completas de agenda e historial de cambios

La agenda del día, semana y mes lee todas las páginas del rango visible, con
orden estable por fecha e ID y conteo exacto. Pedidos, bloqueos y disponibilidad
también se paginan. Se reutiliza `readCompleteCollection`: una página corta no
significa fin si el conteo indica que faltan registros. Un error intermedio,
conteo cambiante o página repetida impide devolver una respuesta exitosa parcial.

La comprobación de notas guardadas usa listas de hasta 200 turnos y páginas
completas. Un fallo no se convierte en «sin post-visita». La disponibilidad
fallida no se transforma en fines de semana cerrados ni capacidad estimada.
La vista mensual conserva `modalidad` en su proyección.

El historial de cambios enumera primero paciente y sesiones mediante el cliente
del usuario y sus políticas RLS. La lectura privilegiada de auditoría queda
limitada a esa organización y esos IDs, en lotes de 200 y páginas ordenadas por
fecha e ID. Los nombres de autores también se leen por lotes. Al terminar se
revalidan contexto, paciente y sesiones con el cliente del usuario; una lectura
fallida o cambio de alcance descarta la respuesta. No se usa el cliente
privilegiado para completar sesiones que RLS haya ocultado.

El historial tiene un límite explícito de 10.000 eventos sin agrupar. Superarlo
devuelve un error que solicita revisión por período, nunca una lista recortada
presentada como completa. Los errores de transporte usan mensajes estáticos,
sin contenido del proveedor. La salida de auditoría conserva sólo etiquetas de
campos, sin valores clínicos.

Verificación: 16 pruebas nuevas sobre las funciones servidor reales ejecutadas
en VM, con transporte sintético que aplica el límite de 1.000 filas y listas de
IDs acotadas; 98 pruebas focales y de regresión en total. Incluyen 1.001 filas,
fallos en segunda página/lotes posteriores, revocación, telemedicina y el límite
de auditoría. Se verificaron las columnas de `turno_extendido` en PostgreSQL 16
local. No se aplicaron migraciones ni se accedió a producción.

Esta paginación detecta cambios de conteo y duplicados; no es una instantánea
transaccional entre solicitudes HTTP. La agenda usa además la revisión M111
leída antes del render para detectar cambios posteriores. La validación de
Supabase Auth/REST real sigue pendiente del entorno local completo.
