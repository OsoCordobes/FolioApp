# Finanzas: agregados y movimientos (M108)

El dashboard obtiene agregados de PostgreSQL y una página de 50 movimientos.
No descarga los pagos de todo el período para sumar en JavaScript. Cada página
se ordena por `created_at DESC, id DESC`; el cursor incluye ambas columnas,
por lo que fechas iguales no omiten ni repiten pagos en un conjunto sin cambios.
La deuda también se pagina: todos los resultados son accesibles con «Siguiente».

## Importes y fechas

- PostgreSQL suma `monto_cents` como enteros y devuelve las sumas como texto.
  Los importes mostrados y el CSV conservan centavos mediante `BigInt`. Los
  números de punto flotante solo intervienen en coordenadas/proporciones visuales.
- Ticket y proyección se redondean al centavo, no al peso. La proyección conserva
  la regla existente: ritmo del mes en curso, sin aplicarlo a períodos arbitrarios.
- Se conserva la atribución por fecha de creación: `created_at` pertenece al
  rango `[inicio, fin)`. `pagado_ts` afina el día solo cuando cae dentro de ese
  rango. Si queda fuera, se usa creación. Una fecha futura registrada dentro
  del período extiende el eje hasta ese dato; no desaparece del total del gráfico.
- Los límites del período se calculan con la zona de la organización (Córdoba
  como respaldo), se mantienen durante la paginación/exportación y la fecha de
  la tabla se presenta explícitamente en Córdoba, no en la zona del navegador.
- `PAGADO` suma ingresos. `PENDIENTE` y `PARCIAL` conservan la interpretación
  existente de deuda por `monto_cents`; no se inventa un importe cobrado parcial
  que el registro no contiene. Las sesiones se cuentan por `turno.inicio` y
  estado `CERRADO`, como antes.

## Filtros y exportación

Los filtros de estado y búsqueda se ejecutan sobre todo el rango en SQL. Nombre
completo/DNI usan el blind index existente (normalización de ese índice, con
claves de lectura y transición legacy); no admiten fragmentos de nombre. Servicio
usa texto contenido, sin interpretar `%` como comodín. El importe es exacto en
pesos argentinos, por ejemplo `1.234,56`. La interfaz explica estas diferencias.
Los indicadores superiores siguen describiendo el período completo; la tabla
informa el número de resultados de sus filtros.

«Exportar resultados» envía los filtros aplicados por POST, sin nombres/DNI en la
URL. El GET heredado exporta el período entero. No hay CSV de éxito parcial:

1. Todas las páginas deben tener la misma revisión y el mismo total. La revisión
   se calcula en la misma sentencia/snapshot que su página e incluye los valores
   y cifrados visibles que se exportarán; una modificación sin cambiar el número
   de filas también invalida la descarga.
2. Repeticiones, cursores detenidos, filas faltantes, errores de base o de
   descifrado cancelan el archivo completo.
3. Límite explícito: 10.000 filas y 10 MB. Se valida también el tamaño final del
   CSV. Reducir el período o reintentar es necesario al superar estos límites.
4. El archivo conserva el escape contra fórmulas de planilla y `Cache-Control:
   no-store`. No se escribe PHI en disco ni en registros de diagnóstico.

El dashboard y la tabla son consultas en vivo separadas: una escritura concurrente
puede cambiar el conteo de la siguiente página. No son un snapshot de navegación
duradero. El CSV sí exige una revisión de contenido idéntica entre sus páginas;
si hay cambios devuelve error en lugar de mezclar versiones. La entrega no promete
que la base siga sin cambios después del último snapshot de lectura.

## Permisos y despliegue

Aplicar `20260908183408_M108_finanzas_aggregates.sql` antes de desplegar el código.
Agrega un índice de cursor y RPC `SECURITY INVOKER`, sin conceder lectura de tablas
ni omitir RLS. Los helpers obtienen el rol y miembro vigentes en la organización
solicitada. OWNER/DIRECTOR ven el conjunto autorizado; PROFESIONAL solo lo propio;
ASISTENTE/COORDINADOR no pueden ejecutar el dashboard. La compuerta MFA M101 se
comprueba explícitamente en las RPC, además de las políticas de las tablas.

M108 cierra también los accesos directos a `pago`: una política restrictiva para
todas las operaciones impide que PROFESIONAL lea/inserte/modifique pagos ajenos o
cambie su turno hacia otro profesional. El rol OWNER en otra organización no
ensancha ese permiso. Las restricciones existentes de turno/caja fuerte siguen
aplicando y los permisos de cobro de recepción se conservan.

Se bloquea DELETE autenticado con una política **restrictiva**: la política
permisiva `false` de M22 se combinaba con `pago_write_admin FOR ALL` y permitía
borrar. No se modifican flujos de guardado clínico ni se habilitan nuevos permisos
de servicio. La preparación MFA desactivada conserva disponibilidad, como M101.

No se aplicó M108 en producción. Verificar allí permisos y plan de ejecución antes
del despliegue; las restricciones de lectura son compatibles con el scoping que
ya enviaba la versión anterior. Las RLS existentes tienen costo por fila: consultas
grandes o exportaciones pueden alcanzar el timeout del servidor y deben fallar
sin archivo parcial. No se ha demostrado capacidad con volúmenes productivos.

## Evidencia local

- SQL con 1.205 pagos: agregados íntegros, páginas de 50/100 filas empatadas por fecha, importes
  con centavos, filtros, zona Córdoba, revisión sensible a modificaciones,
  permisos CRUD, miembro revocado, segunda membresía y compuerta MFA.
- Antes del endurecimiento, el mismo ensayo permitió al profesional leer,
  actualizar e insertar pagos ajenos y borrar un pago propio; luego se rechazan.
- Pruebas unitarias ejecutan la acción y los handlers reales de la tabla con
  dependencias falsas: autorización, cursor, filtros y conservación de resultados
  anteriores ante error. CSV de 1.501 filas, corrupción/repetición/fallo/límites;
  cantidades mayores que la precisión de `Number` y centavos preservados.
- PostgreSQL 16 local y tokens sintéticos. No equivalen a un ensayo de Auth real,
  REST hosteado o rendimiento de Supabase en producción.
