# B09 · emisión y revocación reconciliables (M147)

M147 reemplaza únicamente las RPC de emisión y revocación de M144. Las firmas antiguas dejan de ser ejecutables por `PUBLIC`, `anon`, `authenticated` y `service_role`. La invitación, intercambio, envío y revisión de M144 conservan su contrato. Ninguna RPC nueva devuelve ni enumera tokens.

## Contrato para el cliente de personal

Todas las RPC nuevas exigen JWT de personal autenticado, MFA AAL2 con factor y sesión vigentes, membresía activa y alcance actual sobre el turno. La organización se obtiene de la sesión del servidor; el navegador no elige otra. Los campos `generation` son cadenas decimales para no perder precisión de `bigint`. El cliente trata `contextHash` como valor opaco.

| RPC | Entrada | Resultado |
| --- | --- | --- |
| `patient_intake_link_state` | `p_org`, `p_turno` | `generation`, `contextHash`, `active`, `invitationId`, `expiresAt` (los últimos dos sólo si activa) |
| `patient_intake_issue_v2` | `p_org`, `p_turno`, `p_operation` UUID, `p_expected_generation` bigint, `p_expected_context` SHA-256 hex, `p_token_hash` SHA-256 hex, `p_fingerprint_key_cifrado` bytea | `status: issued\|superseded`, `generation`, y `invitationId`/`expiresAt` sólo si sigue activa |
| `patient_intake_revoke_v2` | `p_org`, `p_turno`, `p_operation` UUID, `p_expected_generation` bigint, `p_expected_context` SHA-256 hex | `status: revoked\|superseded`, `generation`, `revoked` (si había enlace sin revocar) |
| `patient_intake_link_operation_status` | `p_org`, `p_turno`, `p_operation` UUID | `status: not_recorded\|issued\|revoked\|superseded`, `generation`, y metadatos mínimos del resultado vigente; nunca token ni hash |

El navegador genera 32 bytes con WebCrypto y conserva el token crudo, UUID de operación, generación y contexto **sólo en memoria** hasta resolver la operación. Envía al servidor únicamente el SHA-256 de esos bytes. Construye y muestra el enlace o QR sólo tras confirmar `issued`; un resultado incierto se consulta o reintenta con **la misma** operación y el mismo hash. La clave HMAC cifrada puede regenerarse en ese reintento: la primera queda guardada y una clave posterior no reemplaza nada. Una recarga pierde el token; aunque el estado indique enlace activo, no puede recuperarse. El usuario debe revocarlo explícitamente y confirmar ese fence antes de emitir otro. `not_recorded` no prueba que una petición HTTP tardía nunca llegará.

Ambas mutaciones comparan la generación y el contexto capturados **antes del clic** con los actuales. Repetir una operación confirmada devuelve su resultado sólo mientras siga vigente; si otra operación, caducidad o cambio de contexto la superó, devuelve `superseded` sin escribir. Una operación distinta con generación vieja da conflicto. Revocar incrementa la generación incluso sin invitación activa: así una emisión demorada no puede aparecer después de la revocación. Cambios A→B→A de vínculo, cancelación/reprogramación o baja cambian las revisiones incluidas en `contextHash` y no revalidan operaciones antiguas.

El token elegido por el navegador debe provenir de WebCrypto. SQL verifica formato y unicidad del hash, pero **no puede demostrar la entropía** de un token elegido por un cliente que invoque la RPC directamente; esta frontera de seguridad requiere revisión. Los recibos privados vinculan cada operación con actor, sesión Auth, parámetros y generación resultante, sin guardar token ni PII. Ante respuesta perdida se reconcilia la operación; jamás se reemite automáticamente con un UUID nuevo.
