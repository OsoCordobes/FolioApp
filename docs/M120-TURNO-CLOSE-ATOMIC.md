# M120: cierre y registro administrativo atómicos

La migración agrega el límite de base de datos. La activación requiere primero las acciones, mensajes y recuperación en agenda compatibles. No representa un despliegue ni valida servicios reales de Auth/Storage.

## Contrato SQL acordado

Todas las funciones devuelven JSONB salvo la activación (`void`). Los nombres de parámetros forman parte del contrato PostgREST.

| Función | Parámetros exactos |
| --- | --- |
| `public.close_turno_atomic` | `p_org uuid, p_operation uuid, p_turno uuid, p_duracion integer DEFAULT NULL, p_decision jsonb DEFAULT NULL` |
| `public.resolve_turno_close` | `p_org uuid, p_operation uuid, p_turno uuid, p_decision jsonb` |
| `public.get_turno_close_status` | `p_org uuid, p_turno uuid` |
| `public.get_turno_close_receipt` | `p_org uuid, p_operation uuid, p_turno uuid, p_action text, p_duracion integer DEFAULT NULL, p_decision jsonb DEFAULT NULL` |
| `public.enable_turno_atomic_close` | `p_reason text` (mínimo 20 caracteres tras trim) |

Las cuatro primeras entradas son SECURITY INVOKER y se otorgan sólo a `authenticated`; sus implementaciones privadas aplican el permiso completo, incluso cuando se invocan directamente. La activación pertenece sólo a `service_role` o administración de plataforma. No se otorgan tablas privadas al cliente.

`p_operation` es un UUID estable por intento, actor y organización. `p_action` es `CLOSE` o `RESOLVE`. El recibo exige el mismo turno, acción, duración y decisión originales; SQL NULL significa que ese intento todavía no tiene recibo. Consultar el recibo no crea registros. Los reintentos de escritura idénticos también devuelven exactamente el recibo original.

Invocar también las consultas de recibo y estado mediante el modo POST predeterminado de RPC. Son lecturas lógicas sin cambios de negocio, pero adquieren bloqueos; no usar GET ni una transacción de base de datos de sólo lectura.

`p_duracion` NULL conserva el valor previo; 0..480 registra minutos reales. RESOLVE nunca acepta duración. CLOSE nuevo exige ATENDIENDO y la política de escritura clínica M106 activa. RESOLVE exige CERRADO y una decisión financiera explícita.

| `p_decision` | Resultado sin pago previo |
| --- | --- |
| SQL NULL (sólo CLOSE) | REQUIERE_REGISTRO, aunque el precio de lista sea cero |
| `{"montoCents":0}` | SIN_CARGO, sin fila `pago` |
| `{"montoCents":1200,"metodo":"EFECTIVO","pagado":true}` | REGISTRADO y pago PAGADO |
| `{"montoCents":1200,"metodo":"EFECTIVO","pagado":false}` | REGISTRADO y pago PENDIENTE |

El monto positivo es un entero entre 1 y 2147483647; método es el enum vigente `metodo_pago`, y pagado es booleano JSON. Se rechazan campos extra, JSON null, fracciones y conversiones implícitas de texto. Registrar TARJETA o MERCADOPAGO sólo registra lo declarado; SQL no llama ni confirma proveedores.

Respuesta de escritura/recibo:

```json
{
  "turnoId": "uuid",
  "estado": "CERRADO",
  "closedAt": "timestamp del primer cierre o null histórico",
  "origen": "AGENDA",
  "clasificacion": "REGISTRADO",
  "pago": {
    "id": "uuid",
    "montoCents": 1200,
    "metodo": "EFECTIVO",
    "estado": "PAGADO",
    "pagadoTs": "timestamp o null",
    "updatedAt": "pago.updated_at real"
  },
  "puedeRegistrar": true,
  "operationId": "uuid",
  "pagoOrigen": "CREADO"
}
```

Estado actual omite `operationId` y `pagoOrigen`. `origen` puede ser AGENDA, CLINICAL, LEGACY o HISTORICO; es NULL en un turno abierto sin marcador. `clasificacion` también puede ser NULL antes de cerrar. `pagoOrigen` distingue CREADO, EXISTENTE, SIN_CARGO y SIN_DECISION. `pago` es NULL si no existe o si el rol actual es COORDINADOR. `puedeRegistrar` indica capacidad del rol vigente, no que deba registrar un nuevo pago sobre un asiento ya resuelto.

El recibo conserva la confirmación original. Si después se salda PENDIENTE, `get_turno_close_status` refleja PAGADO y su `updatedAt` real; recuperar el recibo no vuelve a escribir el pago. `pago.updated_at` usa el trigger existente basado en `now()` (inicio de transacción): no garantiza un orden estricto de commits ni sustituye una revisión monotónica. El caller debe reconciliar el estado actual y no reemplazar un pago más reciente por la respuesta histórica. No se exige leer ni editar la historia clínica para consultar este estado.

| SQLSTATE | Significado para el caller |
| --- | --- |
| 22023 | Solicitud inválida; conservar formulario y corregir |
| 42501 | Acceso actual insuficiente, MFA o versión antigua bloqueada |
| 40001 | Operación reutilizada con otro contenido o decisión financiera contradictoria; consultar estado |
| 55000 | Estado incompatible; CERRADO se resuelve administrativamente, sin repetir cierre |
| Otros errores SQL | Transacción abortada: no anunciar cierre/cobro confirmado |

Una pérdida de respuesta de transporte tiene resultado incierto. Conservar la misma operación y sus valores; comprobar recibo antes de iniciar una intención nueva. Un pago previo nunca se sobrescribe ni se salda al cerrar; una solicitud contradictoria falla. Si coincide, se devuelve como EXISTENTE con sus datos reales.

## Persistencia y permisos

El trigger de entrada a CERRADO agrega un marcador privado por turno y POST_VISITA en la misma transacción que el UPDATE, incluida la escritura interna de M106. La hora es el primer cierre confirmado más dos horas. `ON CONFLICT DO NOTHING` no mueve ni reinicia trabajos enviados, terminales o con lease. El dispatcher conserva consentimiento, exclusión de organizaciones sintéticas y sus reglas de proveedor incierto; esta migración sólo encola.

M106 mantiene su revisión, validación de contexto, recibos y original bloqueado. El cierre administrativo sólo bloquea el contenido existente mediante M106; no puede crearlo. Si falla la inserción del pago, marcador o cola, también se revierte el cierre nuevo, su transición y el lock/revisión de sesión. Recuperar un CERRADO no toca turno, duración, sesión, fecha de cierre ni cola.

Los cierres anteriores sin marcador se muestran como HISTORICO con fecha desconocida (`closedAt: null`). Al resolverlos se registra esa procedencia sin inventar fecha ni enviar una postvisita antigua. El estado actual consulta el pago real; durante expansión, un INSERT legacy de pago actualiza también el marcador.

Bloqueos: operación → turno → organización → actor → profesional → política/sesión/factor MFA; pago después de esas fuentes. Se conserva turno antes de sesión como M106. Las filas que conceden pertenencia y alcance quedan FOR SHARE hasta commit, y la autorización se evalúa después de esperas. Los métodos MFA existentes siguen siendo la autoridad de AAL/sesión. COORDINADOR cierra sin decisión y no registra ni consulta recibos financieros tras perder permisos; ASISTENTE puede resolver en su agenda sin leer originales; PROFESIONAL sólo opera turnos propios, aun con alcance TODOS.

## Activación gradual

1. Aplicar M120 como migración aditiva con ledger en la misma transacción. Inicialmente el guard está desactivado; los antiguos UPDATE e INSERT siguen funcionando, y nuevos cierres ya dejan marcador y cola.
2. Verificar M106 activo. Integrar CLOSE, seguimiento clínico sin UPDATE redundante, lectura de estado y recuperación administrativa accesible desde agenda.
3. Validar ambos recorridos y su incertidumbre de transporte. Entonces administración llama `enable_turno_atomic_close` con razón auditable. La activación es idempotente y de una sola vía; no existe una desactivación que restablezca cobros automáticos.
4. El guard exige autoridad privada de M120 o WRITE real de M106 para entrar o volver a escribir CERRADO. Un GUC del cliente no concede autoridad. INSERT directo de pago queda bloqueado aun con ON CONFLICT DO NOTHING; mover `pago.turno_id` tampoco permite evadirlo. UPDATE del asiento existente para saldar se conserva.

El único INSERT/upsert de pago de la aplicación inventariado antes de este cambio está en `lib/db/turnos.ts`; las acciones de Finanzas y AFIP actualizan asientos existentes. No activar sin sustituir ese caller y el seguimiento clínico antiguo. Las tablas privadas no tienen API de listado global: el caller de agenda puede solicitar el estado por los turnos autorizados que ya muestra. Un futuro listado necesita un contrato autorizado propio.

## Verificación reproducible

El informe de ejecución está en `.flow/launch-reliability/atomic-close-report.md`. En el checkpoint de código, las dos specs pasaron individualmente y la concurrencia pasó 8/8; el replay completo de la versión final sigue pendiente. Las dos specs SQL usan `tests/fixtures/M120_turno_close.sql` dentro de una transacción reversible. `tests/integration/turno-close-concurrency.mjs` exige una base local nueva con prefijo `folio_test_launch_m120_`, conserva su fixture sintético y no resetea bases ni modifica roles compartidos.

Se prueba PostgreSQL16 con stubs de Auth/Storage y roles/RLS SQL. Esto no acredita login, MFA ni Storage servidos por Supabase real, proveedores, producción o despliegue.
