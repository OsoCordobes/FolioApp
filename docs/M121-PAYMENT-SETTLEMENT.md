# M121: saldo de un pago con autorización vigente

M121 agrega una transacción para marcar un pago existente como PAGADO. Corrige la carrera comprobada en el UPDATE directo: una sentencia que esperaba un bloqueo podía confirmar el cobro después de que otro usuario revocara el permiso o reasignara el turno. El helper de TypeScript debe consumir este RPC; volver al UPDATE REST no conserva esta garantía.

## Contrato exacto

`public.settle_pago_atomic(p_org uuid,p_turno uuid,p_pago uuid) RETURNS jsonb`

Los tres UUID son obligatorios. La organización proviene de la sesión activa del caller; turno y pago deben seguir vinculados cuando la base obtiene los bloqueos. No se reciben importe, método, timestamp, estado ni operation ID. La única identidad idempotente es el pago existente.

```json
{
  "turnoId": "uuid",
  "alreadyPaid": false,
  "pago": {
    "id": "uuid",
    "montoCents": 1200,
    "metodo": "EFECTIVO",
    "estado": "PAGADO",
    "pagadoTs": "timestamp real almacenado",
    "updatedAt": "pago.updated_at real"
  }
}
```

`alreadyPaid=true` significa que ese llamado encontró PAGADO: devuelve sus campos actuales sin actualizarlo ni mover su fecha. PENDIENTE o PARCIAL se convierten en PAGADO con `pagado_ts` calculado en la base y retornado desde la fila guardada. No se crea un nuevo pago ni un nuevo sistema de recibos.

El retry del mismo pago resuelve una respuesta perdida sin volver a saldarlo. Cada retry vuelve a comprobar permisos; el pago conocido no concede acceso después de revocación o reasignación. `updatedAt` usa el trigger existente basado en el inicio de transacción (`now()`), por lo que no es una revisión monotónica de commits. El recibo de cierre M120 conserva su resultado histórico; este RPC devuelve el pago actual y no reescribe aquel recibo.

Usar el modo POST predeterminado de RPC, también para comprobar un pago que probablemente ya esté saldado. El llamado adquiere bloqueos y puede realizar el saldo; no usar GET/read-only.

| Rol vigente | Alcance del RPC |
| --- | --- |
| OWNER / DIRECTOR | Pagos de su organización autorizada |
| PROFESIONAL | Sólo sus propios turnos, incluso con alcance TODOS |
| ASISTENTE | Su alcance de recepción y turno CERRADO |
| COORDINADOR, portal, anónimo, miembro revocado | Sin permiso |

OWNER, DIRECTOR y PROFESIONAL conservan la posibilidad existente de saldar un pago previo en un turno abierto. ASISTENTE necesita CERRADO para su recuperación desde agenda. El wrapper de Finanzas debe conservar `canSeeFinanzas`; permitir este RPC al asistente no le abre esa página ni la historia clínica.

| SQLSTATE | Significado |
| --- | --- |
| 22023 | Faltan IDs o razón de activación válida |
| 42501 | Permiso/MFA/organización/asociación actual insuficiente; también escritura directa bloqueada |
| 55000 | Asistente solicita turno no cerrado, estado de pago incompatible o falta un requisito de activación |
| Otros errores SQL | La transacción no confirmó el saldo; conservar la intención y manejar el error |

Un éxito siempre contiene una fila real PAGADO. Nunca se deduce de “cero filas actualizadas”. Un error de transporte sigue siendo resultado incierto: comprobar/reintentar ese mismo pago, sin inventar otra operación financiera.

## Bloqueos y escritura limitada

El orden es turno FOR UPDATE → organización/actor/profesional y fuentes MFA vigentes mediante el autorizador privado M120 → pago FOR UPDATE. Después de esperar el pago se vuelve a validar la autorización y la asociación. Las fuentes previamente bloqueadas permanecen protegidas hasta commit.

Si una revocación o reasignación confirma mientras el RPC espera el turno, el RPC la observa y rechaza el saldo. Si el RPC ya aseguró sus fuentes y después espera un pago, la revocación espera a que termine esa transacción. Así no puede cambiar silenciosamente el permiso debajo del saldo autorizado. No se añaden bloqueos de turno dentro de un trigger de pago que inviertan este orden.

La escritura modifica únicamente `pago.estado`, `pago.pagado_ts` y el `updated_at` administrado por el trigger existente. No cambia clínica, estado/duración del turno, importe, método, asociación, factura, notas, comisión ni cola. Un fallo del UPDATE revierte también la autoridad privada transaccional.

## Activación gradual

`public.enable_payment_settlement_authority(p_reason text) RETURNS void` es una entrada SECURITY INVOKER restringida a service_role/administración de plataforma. Exige una razón de al menos 20 caracteres tras trim y las políticas M106 y M120 activas. Registra la primera activación; repetirla conserva ese registro. No tiene un camino público de desactivación.

1. Aplicar la migración aditiva y su ledger en una transacción. El guard M121 empieza desactivado y mantiene compatible el UPDATE antiguo durante la preparación.
2. Integrar y verificar los callers de Finanzas y agenda con `settle_pago_atomic`, conservando sus permisos de página. Retirar el fallback a UPDATE REST.
3. Con M106/M120 activos y los callers compatibles verificados, administración activa M121 con una razón auditable. No se activa como parte de esta tarea.

Una vez activo, los UPDATE autenticados que nombran `estado`/`pagado_ts` requieren autoridad privada, aunque sean redundantes o se mezclen con metadata. Otro trigger tampoco puede cambiar esos campos aprovechando un UPDATE que inicialmente sólo nombró metadata. El guard no adquiere un turno después de bloquear pago. Un UPDATE antiguo ya en espera al activarse la política también se rechaza cuando llega al guard.

Metadata sin cambios de estado/fecha mantiene el comportamiento anterior. El mantenimiento de plataforma usa el mismo criterio de rol SQL confiable de M118 (`postgres`, `service_role`, `supabase_admin`, sin rol original anon/authenticated). Un helper SECURITY DEFINER invocado por authenticated no hereda esa excepción. Un GUC personalizado o una declaración JWT de service_role no concede autoridad.

El checker privado invocable por el trigger sólo verifica la política y la autoridad tx/pago/usuario; llamarlo directamente no crea autoridad ni expone pagos. Las tablas privadas tienen RLS y carecen de grants de cliente. La función pública es invoker; su entrada privada implementa la autorización completa incluso si se invoca directamente.

## Evidencia y límites

- Defecto previo reproducido con PostgreSQL16: tres UPDATE en espera confirmaron una fila PAGADO después de perder autorización, mientras un control posterior del mismo usuario actualizaba cero filas.
- Replay final en una base sintética nueva: **115 migraciones / 63 specs SQL PASS** con verificación predeterminada de cuerpos de funciones.
- Concurrencia M121: **6/6 PASS** — corte de versión antigua mientras espera, repetición simultánea/recuperación del mismo pago, reasignación, revocación de miembro, pérdida de alcance de asistente y retención de autorización mientras espera el pago y hasta commit.
- Evidencia almacenada: 21 pagos existentes, sólo 2 saldados por los casos autorizados, cero autoridades residuales, una activación, originales clínicos y trabajos de recordatorio idénticos al snapshot inicial.

Los detalles, comandos, digests e IDs sintéticos permanecen en `.flow/launch-reliability/settlement-authority-report.md` y sus logs locales ignorados. Las pruebas SQL usan stubs de Auth/Storage y roles/RLS de PostgreSQL: no certifican login, MFA servido por Supabase, PostgREST HTTP, Storage, proveedores, producción ni despliegue.
