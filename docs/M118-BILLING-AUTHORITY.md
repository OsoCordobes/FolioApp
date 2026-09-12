# Integridad del estado comercial

La revisión del 12 de septiembre encontró formas distintas de eludir la suspensión comercial. Se reprodujeron en PostgreSQL local con datos sintéticos y transacciones que se revirtieron completamente. La comprobación independiente de producción confirmó los permisos de tabla relevantes, sin cambiar datos.

1. El dueño podía cambiar directamente `suscripcion.estado` a `ACTIVA`, insertar una suscripción o borrar una existente. La política `suscripcion_write_owner` permitía todas las operaciones. La política de borrado con `false` era permisiva: no anulaba ese permiso más amplio.
2. El dueño podía cambiar `organization.created_at` a una fecha futura. Como esa fecha inicia la prueba de 30 días, podía renovar su período de prueba sin pagar.
3. En la versión publicada, el dueño todavía podía marcar su consultorio como cuenta interna de Folio y quedar exento del cobro. M98 lo corrige en la rama de trabajo; M118 incluye el mismo control para poder publicarse de forma independiente.
4. Aunque la pantalla redirigiera a facturación, las llamadas directas para crear pacientes y turnos seguían aceptándose. El control comercial está en el diseño de página, no en la transacción de negocio.

Los tres primeros son hallazgos altos de autorización comercial y quedan corregidos por M118. El cuarto permanece abierto: requiere un control de escritura compatible con la continuidad clínica.

## Cambio acotado de M118

- La cuenta autenticada conserva la lectura autorizada de su suscripción. Pierde los permisos de insertarla, modificarla, borrarla o vaciar la tabla. También se retiran permisos de columna que podrían existir de forma independiente.
- Se elimina la política que permitía al dueño escribir el estado de la suscripción.
- Un disparador rechaza esas escrituras de usuarios comunes incluso si reaparecieran permisos o una función con privilegios elevados intentara efectuarlas en su nombre.
- La fecha de creación del consultorio queda protegida frente a cambios del dueño y fechas forjadas al insertar. El alta normal usa la fecha de la base de datos; las tareas administrativas autorizadas conservan la posibilidad de restaurar fechas históricas.
- La exención reservada a cuentas internas solo puede concederse o revocarse por la plataforma. M118 usa objetos distintos de M98: ambas defensas pueden coexistir y tienen la misma condición de autoridad.
- Los trabajadores de cobro, webhooks y acciones comerciales existentes ya usan el cliente de servicio. No requieren convertir nuevas llamadas a un cliente privilegiado. Esto se verificó tanto en la rama de trabajo como en la versión publicada.

No se activa un bloqueo clínico, no se cambian precios ni suscripciones y no se eliminan datos. La migración es compatible con el código publicado y puede aplicarse antes de desplegar las demás mejoras. Ante un problema, se debe corregir la vía de escritura autorizada; no volver a habilitar la escritura del estado de pago desde el navegador.

## Evidencia

La transacción pertenece al ejecutor del despliegue: M118 no contiene `BEGIN` ni `COMMIT` exteriores. `scripts/push-pending-migrations.mjs` abre la transacción, ejecuta la migración, registra su versión canónica y recién entonces confirma. La aplicación por CLI/MCP debe conservar esa misma unidad; una ejecución manual con psql requiere `--single-transaction`, incluyendo la inserción del registro de migración. No ejecutar el archivo manualmente en modo autocommit: sus `SET LOCAL` también requieren transacción.

`tests/migrations/M118_ledger_transaction.sql` reproduce el fallo entre la modificación del esquema y el registro de versión: provoca un error en el ledger y exige que el rollback restaure esquema, disparadores, política y permisos de tabla y columnas. Con el archivo anterior, el `COMMIT` interior dejaba el esquema aplicado sin versión y la prueba fallaba. SQL CI ejecuta esta regresión antes de M118 y aplica cada migración con `psql --single-transaction`. Los specs mantienen sus límites propios; ejecutar migraciones con psql autocommit solo comprueba SQL y no demuestra atomicidad del despliegue.

`tests/sql/M118_billing_authority.spec.sql` comprueba lectura legítima, prohibición de estado pagado forjado y borrado, fecha futura y exención interna rechazadas, cambios ordinarios de configuración permitidos, resistencia a permisos accidentales y funciones privilegiadas, persistencia del proveedor autorizada y alta de consultorio mediante el procedimiento habitual. También reproduce los INSERT/UPSERT/UPDATE de la versión publicada, incluidos activación, cobro, cambio de monto y cancelación, sin consultar ni cobrar a proveedores reales. Las pruebas completas incluyen las operaciones transaccionales de cobro de M99.

La reproducción previa también confirmó que el período de prueba estaba vencido antes de crear un paciente y turno nuevos. No se confundió la entrega histórica deliberadamente habilitada en `/archivo-clinico` con nuevas prestaciones de agenda.

## Compatibilidad con el corte publicado

Se inspeccionó el commit exacto `2dae58011e26e5baadd1ccd2c6b2125c195218f8`, que contiene 91 migraciones hasta M97. M118 depende de las tablas de M02/M19 y de la columna interna de M37; no necesita M98–M117, nuevo código, una cola ni el archivo clínico.

| Escritura publicada | Autoridad comprobada |
| --- | --- |
| Crear/reactivar la suscripción, cancelar, actualizar estado, registrar cargo y sincronizar monto | `lib/db/suscripcion.ts` crea un cliente de servicio en cada camino. |
| Webhook de cargo | Llama a `recordChargeAttempt` sin sustituir el cliente; usa el servicio. El argumento opcional solo se sustituye en pruebas. |
| Conciliación y actualización manual | Llaman a esos mismos escritores. Las acciones manuales exigen OWNER antes de llamarlos. |
| Alta con correo y alta con Google | `app/(public)/onboarding/actions.ts` llama a `bootstrap_org_atomic` con el servicio. M33/M37/M45 reservan su ejecución a ese rol. |
| Configuración común del consultorio | Escribe campos permitidos y conserva fecha y exención. |

El cliente de servicio publicado lee `SUPABASE_SERVICE_ROLE_KEY` y no incorpora las cookies de sesión del usuario. No se encontró una escritura legítima de suscripción mediante el cliente autenticado común. M118 no cambia filas existentes ni reinterpreta el período pagado.

Validación del archivo definitivo con límites de bloqueo: la cadena exacta publicada más M118 aprobó **92 migraciones y 31 archivos de pruebas SQL**; la rama completa aprobó **112 migraciones y 57 archivos de pruebas SQL**. Ambas partieron de bases nuevas y usaron PostgreSQL 16 con comprobación de cuerpos de funciones activada por defecto. El caso de exención interna primero falló contra M118 sin esa defensa y pasó con el control incorporado.

También se verificó desde otra base nueva el orden real de actualización: las 91 migraciones publicadas, M118 y luego las 20 pendientes M98–M117. Ese recorrido aprobó **112 migraciones y los mismos 57 archivos de pruebas SQL**, incluidos los controles simultáneos de M98/M118. Se conservó cada archivo SQL sin cambios; solo se ordenó esa reproducción para representar el despliegue escalonado.

### Comprobaciones de despliegue de solo lectura

Ejecutar con conexión administrativa autorizada; la salida siguiente contiene metadatos y cantidades, sin correos, claves ni contenido clínico. Antes de aplicar, confirmar que M118 no esté registrada, que los objetos no colisionen y que el servicio conserve los permisos necesarios. Si el inventario difiere del esperado, revisar la diferencia antes de aplicar.

```sql
BEGIN TRANSACTION READ ONLY;
SELECT current_user, current_setting('role', true) AS sql_role,
       current_setting('server_version_num') AS postgres_version;
SELECT count(*) AS migration_count,
       count(*) FILTER (WHERE version='20260912163934') AS m118_recorded
FROM supabase_migrations.schema_migrations;
SELECT to_regnamespace('folio_billing_authority_private') AS m118_schema;
SELECT r.rolname, r.rolbypassrls,
       has_table_privilege(r.rolname,'public.suscripcion','SELECT') AS can_select,
       has_table_privilege(r.rolname,'public.suscripcion','INSERT') AS can_insert,
       has_table_privilege(r.rolname,'public.suscripcion','UPDATE') AS can_update,
       has_table_privilege(r.rolname,'public.suscripcion','DELETE') AS can_delete,
       has_table_privilege(r.rolname,'public.suscripcion','TRUNCATE') AS can_truncate
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
SELECT c.relname, a.attname, a.attnotnull,
       pg_get_expr(d.adbin,d.adrelid) AS column_default
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='public.organization'::regclass
  AND a.attname IN ('created_at','is_internal_account');
SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('organization','suscripcion');
SELECT c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE t.tgrelid IN ('public.organization'::regclass,'public.suscripcion'::regclass)
  AND NOT t.tgisinternal;
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
       has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS client_execute
FROM pg_proc p WHERE p.oid=to_regprocedure(
  'public.bootstrap_org_atomic(uuid,text,text,text,text,text)');
SELECT count(*) FILTER (WHERE created_at>transaction_timestamp()) AS future_trial_dates,
       count(*) FILTER (WHERE is_internal_account) AS internal_accounts
FROM public.organization;
COMMIT;
```

Después de aplicar, repetir el inventario: M118 registrada una sola vez con versión canónica `20260912163934`; INSERT/UPDATE/DELETE/TRUNCATE de `suscripcion` falsos para `authenticated` y `anon`; lectura previa conservada; sin `suscripcion_write_owner`; los tres triggers nuevos habilitados (`subscription_platform_write`, `subscription_platform_truncate`, `organization_platform_settings_guard`). Las fechas futuras o cuentas internas preexistentes se investigan individualmente; esta migración no las corrige ni elimina automáticamente.

Las comprobaciones negativas y las escrituras de alta/cobro se ejecutan en bases sintéticas, no sobre pacientes o suscripciones reales. La prueba local usa roles y tablas auxiliares de Auth/Storage; no acredita por sí sola la entrega real de un webhook, SMTP o una compra en Mercado Pago. El despliegue independiente registra solo M118: no se deben marcar M98–M117 como aplicadas. Su aplicación posterior conserva el control de M118.

La migración completa está dentro de una transacción y fija `lock_timeout='5s'` y `statement_timeout='30s'`. Si no consigue un bloqueo a tiempo, debe abortar y conservar el estado anterior. Ante ese resultado se revisa la actividad y se reintenta la misma migración; no se deshabilitan las defensas ni se aplican fragmentos por separado.

## Siguiente bloqueo: escritura durante suspensión

La solución propuesta es separar explícitamente la autorización clínica de la autorización para iniciar operaciones comerciales nuevas. Debe seguir siendo posible leer y entregar información autorizada, recuperar el acceso, pagar, cancelar, corregir una historia y completar la atención que ya estaba en curso.

1. Crear una decisión comercial única en la base, usando las fechas protegidas y el estado confirmado por el proveedor. Mantener inicialmente el control desactivado y contrastar sus resultados con `computeAccessGate`.
2. Aplicarla a la creación de turnos, pacientes por importación y solicitudes públicas, incluyendo los escritores antiguos directos y los procedimientos llamados por el servicio. Un control solo en Server Actions volvería a dejar abierto REST; omitir todo `service_role` dejaría abiertas las reservas públicas.
3. Distinguir el inicio de una nueva atención del guardado o cierre de una atención ya iniciada. La excepción debe apoyarse en un registro de inicio protegido por la base, no en una fecha o estado editables enviados por el navegador. Al activar, registrar las atenciones que ya estén en curso y comprobar que pueden guardarse y cerrarse.
4. Conservar lectura, exportación, enmiendas autorizadas, corrección de identidad, gestión del consentimiento y conciliación de cobros previos. Los trabajos ya pendientes se resuelven según su origen; no se eliminan mensajes ni historias.
5. Probar por acción directa, REST y RPC: cuenta activa, prueba vigente/vencida, mora/cancelación dentro y fuera del período pagado, pausa, cuenta interna, proveedor temporalmente inaccesible y atención abierta durante el cambio de estado. Solo después activar la política.

Hay decisiones de producto que deben quedar escritas antes de activar ese control: si un turno futuro contratado antes de la suspensión puede reprogramarse o atenderse; cómo ofrecer asistencia extraordinaria por urgencia; y qué período pagado representa exactamente `proxima_cobro`. La aplicación actual permite `ACTIVA`, admite mora/cancelación antes de `proxima_cobro`, bloquea `PAUSADA` y además aplica la prueba inicial a ciertos estados vencidos. Estas reglas deben preservarse o modificarse deliberadamente, sin improvisar un corte durante una consulta.
