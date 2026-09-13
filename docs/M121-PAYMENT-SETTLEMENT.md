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

El candidato posterior agrega M122 para la agenda operacional de recepción en Hoy: ASISTENTE conserva la consulta autorizada y vigente de pagos; COORDINADOR recibe los campos financieros vacíos. M123 restringe también el SELECT directo de `pago` a roles financieros vigentes, componiendo con el alcance RLS de M92 y MFA de M101. COORDINADOR no obtiene filas de pago por esa vía. Estas migraciones no cambian el contrato de saldo M121 ni conceden acceso clínico a recepción.

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
3. Con M106/M120 activos y los callers compatibles verificados, administración activa M121 con una razón auditable. El ensayo local usa un procedimiento separado y revisado; aplicar o activar en producción requiere inventariar el destino y autorización de publicación. Esta goal no realizó cambios productivos.

Una vez activo, los UPDATE autenticados que nombran `estado`/`pagado_ts` requieren autoridad privada, aunque sean redundantes o se mezclen con metadata. Otro trigger tampoco puede cambiar esos campos aprovechando un UPDATE que inicialmente sólo nombró metadata. El guard no adquiere un turno después de bloquear pago. Un UPDATE antiguo ya en espera al activarse la política también se rechaza cuando llega al guard.

Metadata sin cambios de estado/fecha mantiene el comportamiento anterior. El mantenimiento de plataforma usa el mismo criterio de rol SQL confiable de M118 (`postgres`, `service_role`, `supabase_admin`, sin rol original anon/authenticated). Un helper SECURITY DEFINER invocado por authenticated no hereda esa excepción. Un GUC personalizado o una declaración JWT de service_role no concede autoridad.

El checker privado invocable por el trigger sólo verifica la política y la autoridad tx/pago/usuario; llamarlo directamente no crea autoridad ni expone pagos. Las tablas privadas tienen RLS y carecen de grants de cliente. La función pública es invoker; su entrada privada implementa la autorización completa incluso si se invoca directamente.

## Evidencia y límites

- Defecto previo reproducido con PostgreSQL16: tres UPDATE en espera confirmaron una fila PAGADO después de perder autorización, mientras un control posterior del mismo usuario actualizaba cero filas.
- Replay del corte M120/M121 en una base sintética nueva: **115 migraciones / 63 specs SQL PASS** con verificación predeterminada de cuerpos de funciones.
- Actualización local desde `28ab28a` hacia `34dc605`: **92 migraciones publicadas primero (M118 incluida), luego 23 faltantes y 63 specs SQL PASS**. Ledger final de 115 versiones exactas, sin modificar archivos compartidos. Este orden distinto del replay cronológico también quedó verificado; informe `.flow/launch-reliability/published-upgrade-report.md`.
- Concurrencia M121: **6/6 PASS** — corte de versión antigua mientras espera, repetición simultánea/recuperación del mismo pago, reasignación, revocación de miembro, pérdida de alcance de asistente y retención de autorización mientras espera el pago y hasta commit.
- Evidencia almacenada: 21 pagos existentes, sólo 2 saldados por los casos autorizados, cero autoridades residuales, una activación, originales clínicos y trabajos de recordatorio idénticos al snapshot inicial.
- Evidencia posterior del cierre: **replay completo de 116 migraciones / 64 specs PASS** con M122, seguido de **M123 focal y cinco specs afectados PASS** (M92, dos M120, M121 y M122). La fuente `17a3770` tiene 117 migraciones; no se ejecutó el replay completo de ese total. M122/M123 recibieron revisión independiente y permanecen sin instalar en el runtime clínico de 115 migraciones.

Al 13 de septiembre, los consumidores de servidor y la UI de recuperación están implementados y revisados; la interfaz de `8a802e0` aprobó 36/36 pruebas de navegador aisladas. El operador local completó el inventario, instaló M120/M121 con sus registros y activó sus controles en orden, con una entrada de auditoría cada uno. El corte local quedó en 115 migraciones y nueve controles activos, conservando los datos anteriores. La auditoría corresponde a `3a9823a`; no se reinstala SQL ni se repiten activaciones por las revisiones posteriores de código.

Run-11 terminó con 2 aprobados y 10 fallidos por la diferencia de zona horaria entre formulario y agenda. `c57f8f2` corrigió ese defecto y aprobó la compilación aislada (exit 0, 16 avisos heredados) y 50/50 escenarios de formularios. Run-12 confirmó la fecha y hora completas de los diez turnos, pero terminó con 4 aprobados y 8 fallidos: seis problemas del selector/observador y dos fallos de llegada/Auth sin causa determinada. No se creó ningún pago en esa campaña; por tanto, no acredita la recuperación integrada de M121.

El candidato de pruebas `280ef18` conserva la aplicación de `c57f8f2`, corrige la instrumentación y agrega diagnóstico sanitizado sin reintentos ni ampliación de plazos. Aprobó revisión independiente, tipos, lint completos y 2212/2212 unitarias, incluidas 20 comprobaciones de seguridad, 5 diagnósticos Auth y 7 de llegada. Run-13 sobre esa revisión terminó con **6 aprobados y 6 fallidos, sin omisiones**. Pasaron las recuperaciones de CLOSE y RESOLVE tras perder respuestas ya confirmadas en SQL. El caso específico de saldo M121 se detuvo al comprobar la confirmación visual del cierre clínico, antes de saldar el pago; por eso no acredita la recuperación integrada de M121. Los casos de recepción autenticaron sus roles y alcances, pero la agenda vacía impidió completar sus comprobaciones.

Los defectos posteriores se corrigieron con revisión independiente y pruebas puntuales: limpieza del observador, aviso de cierre propio, lectura de recepción M122 y SELECT financiero M123. El último cambio de aplicación es `6a75cc1`; la fuente final es `17a3770`. Aprobaron **2231/2231 unitarias, tipos, lint y compilación aislada**; la confirmación del cierre propio aprobó **12/12 escenarios de navegador y 13/13 unitarias**, y el lector de Hoy **22/22 unitarias**. El usuario pidió cerrar y no repetir el recorrido: **no hay run-14 ni un 12/12 integrado del código final**. El baseline histórico 7/7 usó 113 migraciones y tampoco verifica esta frontera. El [registro de confiabilidad](LAUNCH-RELIABILITY-LOG.md) y la [entrega de revisión](LAUNCH-RELIABILITY-DELIVERY.md) conservan la evidencia local y sus límites, sin atribuirla a producción.

La consulta de sólo lectura del 13/09 confirmó producción con **92 migraciones**, sin las políticas MFA/M106/M120/M121 ni el RPC M122. Faltan 25 migraciones frente a la fuente final. La entrega se prepara para push y PR en borrador; el merge queda retenido porque `master` despliega automáticamente y requiere ese corte de base y activaciones compatibles. No se aplicaron migraciones productivas, no se desplegó el candidato ni se hicieron cobros reales.

Los detalles, comandos, digests e IDs sintéticos permanecen en `.flow/launch-reliability/settlement-authority-report.md` y sus logs locales ignorados. Las pruebas SQL usan stubs de Auth/Storage y roles/RLS de PostgreSQL: no certifican login, MFA servido por Supabase, PostgREST HTTP, Storage, proveedores, producción ni despliegue.
