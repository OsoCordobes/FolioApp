# Panel de operación de Folio

Estado del corte G2: implementación local, sin habilitar operadores, reporteros ni tareas en producción. M115 es aditiva y debe instalarse antes del código que consulta sus funciones. No reemplaza el seguimiento de proveedores, el control de admisión ni una prueba de recuperación.

## Acceso independiente

`/operacion` está fuera del layout de consultorios y de su bloqueo por facturación. `/api/operacion` ofrece la misma lectura autenticada, con `Cache-Control: private, no-store`. La página es dinámica y no se indexa.

No alcanza con ser OWNER, DIRECTOR ni tener un atributo `operator` en el perfil. El servidor verifica al usuario y AAL2. La base vuelve a verificar AAL2, la sesión actual, su factor verificado y una autorización vigente en `folio_operations_private.operator_account`. La exigencia AAL2 del panel se mantiene aunque el despliegue general de MFA siga desactivado. No se consulta con el cliente de servicio desde el navegador o el servidor de la página.

La lista empieza vacía. Una persona responsable debe revisar la identidad del operador y registrar manualmente el UUID de Auth, la fecha de vencimiento y una referencia de revisión sin datos personales. El contrato de bootstrap es `operations_set_operator(p_user uuid, p_enabled boolean, p_expires_at timestamptz, p_reference text)`, ejecutable sólo por `service_role` y el administrador de la base. No hay formulario ni endpoint público para conceder acceso.

- Alta o renovación: `p_enabled=true`, vencimiento futuro de hasta 366 días.
- Revocación: `p_enabled=false`; no depende del vencimiento original.
- Referencia: código interno de 8–80 caracteres, sólo mayúsculas, números, `_`, `:`, `-`. Nunca correos ni nombres.
- Se conserva historial de altas, renovaciones y revocaciones. Cada lectura revalida la autorización; una respuesta que ya recibió un operador no puede retirarse de su pantalla.

La entrada puede abrirse directamente después de autenticarse. La pantalla no habilita reintentos, borrados, cambios de suscripción ni acciones sobre proveedores.

## Lecturas y límites

Se agregan las colas de avisos de facturación, correo, Google Calendar, reservas, operaciones de cobro y recepciones de webhooks. Sólo salen contadores y la fecha del pendiente más antiguo: no salen IDs, organizaciones, pacientes, destinatarios, contenido, errores libres, tokens ni respuestas de proveedores. “Terminal” puede indicar bloqueo o necesidad de revisión, no necesariamente un fallo técnico. El estado local tampoco certifica disponibilidad externa.

Cada fuente falla por separado a `unknown`. Si toda la consulta falla, se muestra indisponibilidad. Los valores faltantes o inválidos no se convierten en cero. El transporte de la lectura lleva un límite de ocho segundos; las consultas son agregaciones en vivo y necesitarán medir rendimiento con el volumen real antes de ampliar el piloto.

| Medida | Fuente y alcance |
| --- | --- |
| Base de datos | `pg_database_size(current_database())`, tamaño de la base local completa. No equivale necesariamente a la medida facturada. |
| Archivos | Suma de `storage.objects.metadata.size` de todo el inventario. Un tamaño faltante o inválido vuelve desconocido el total. No comprueba objetos huérfanos, contenido remoto ni factura. |
| Miembros activos | Membresías vigentes en organizaciones no eliminadas. Incluye cuentas internas y sintéticas. No mide usuarios activos mensuales de Auth ni una cuota del proveedor. |
| Correo aceptado | Aceptaciones persistidas de la cola Folio durante el mes calendario UTC. No incluye envíos ajenos a esta cola; consumo total y cuota facturada siguen desconocidos. |

No se presupone un plan comercial. `operations_set_quota(p_metric text, p_limit bigint, p_valid_until timestamptz, p_reference text)` permite registrar manualmente, sólo con servicio, una capacidad comprobada y comparable con la medida. Catálogo: `database_bytes`, `storage_bytes`, `active_members`, `email_accepted_month`. Valor positivo, vigencia futura de hasta 93 días y referencia sin datos personales. La fecha de comprobación se registra en la base. No ingresar un límite cuyo período o criterio de medición difiera de la fuente local. Sin límite vigente la capacidad disponible es desconocida, aunque se conozca el consumo.

La configuración privada inicial fija aviso al 60% y umbral de pausa al 70%. Es una señal para el procedimiento de admisión/importaciones masivas; este panel de lectura no aplica un bloqueo automático. La proyección de crecimiento puede exigir actuar antes. Los porcentajes no certifican capacidad suficiente para nuevos clientes.

## Contrato de reportes de copias

Hasta que un proceso de copias envíe metadatos se muestra **Sin reporte**. Este corte no instala ese proceso, no agenda ejecuciones ni declara una copia externa al equipo.

El contrato futuro de servicio es:

```text
operations_report_backup(
  p_run uuid,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_outcome text,                 -- success | partial | failed
  p_archive_bytes bigint,
  p_object_count bigint,
  p_integrity_verified boolean,
  p_restore_scope text,           -- none | structure | full
  p_restore_verified_at timestamptz
)
```

`p_run` identifica una ejecución. El emisor debe persistir ese ID y exactamente los mismos metadatos antes de enviar: la repetición idéntica es idempotente; cambiar el contenido con el mismo ID falla con conflicto. No hay campos de nombre de archivo, ruta, URL, clave, contenido o error libre. No añadirlos al reporte. Fechas y contadores se validan; `none` requiere fecha de restauración nula y los otros alcances requieren fecha válida.

El emisor debe declarar hechos comprobados, sin transformar una restauración de estructura en una restauración completa. El panel presenta todo como **declarado** y separa el último intento de la última copia cuya integridad se informó verificada (resultado parcial o exitoso, archivo no vacío). Advierte cuando falta esa copia o supera 24 horas: un fallo reciente no reinicia este plazo. Conserva explícitamente el resultado del último intento y su alcance de restauración. No ejecuta una restauración ni verifica por sí mismo el archivo. La copia fuera del equipo sigue “sin reporte”: este contrato no la certifica.

## Validación local y despliegue pendiente

- PostgreSQL 16 aislado con M115 y su spec: lista vacía, OWNER ajeno, anon, AAL1, revocación, vencimiento del operador/sesión y factor no verificado denegados. Escrituras de bootstrap, cuota y reportes denegadas a usuarios autenticados.
- La prueba oculta una tabla de cola y mantiene las demás fuentes legibles; un objeto Storage sin tamaño produce desconocido. La prueba comprueba que los agregados no contienen los valores sensibles sintéticos.
- Recibo de reporte repetido idéntico aceptado incluso desde otra zona horaria SQL; mismo ID con resultado diferente rechazado. Una copia parcial y restauración de estructura conservan esos estados. Una copia de 25 horas seguida por un fallo reciente mantiene el aviso. Sin copia verificada no se inventa una fecha. Cuotas vencidas no se usan.
- Pruebas unitarias del modelo, servidor y frontera GET; navegador Chromium con el componente React real en desarrollo/StrictMode y producción, escritorio y móvil. El navegador usa datos locales sintéticos: no prueba un despliegue Next autenticado contra Supabase real.
- Pendiente antes de habilitar: migración y código en entorno autorizado, smoke con operador real revisado y cuenta sin autorización, configuración de capacidades con fuentes actuales, medición de consultas y conexión auditable del reportero de copias. No activar el reportero ni programaciones sólo por instalar esta migración.

Referencias de la separación de acceso: [MFA de Supabase](https://supabase.com/docs/guides/auth/auth-mfa) y [seguridad por filas](https://supabase.com/docs/guides/database/postgres/row-level-security).
