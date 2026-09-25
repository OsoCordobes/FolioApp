# B06 · Paquete de exportación clínica con archivos

## Contrato del primer tramo (B06b1 / M134)

La entrega completa es profesional y mediada: sólo `OWNER` o `DIRECTOR`
colegiado con acceso actual a la ficha, sesión vigente y MFA válido puede
iniciarla o retomarla. El trabajo fija `actor_user_id`, `actor_member_id`,
organización, paciente y SHA-256 de un inventario verificado. El servidor
resuelve esos identificadores desde la sesión autenticada; ningún parámetro
HTTP puede afirmar que una categoría está completa. La autorización se
revalida con el cliente RLS antes de cada operación y, al entregar bytes en
B06b2, antes y después de leer cada fragmento. Los bytes ya entregados no
pueden revocarse retroactivamente.

M134 crea un ledger privado y un bucket privado. `anon`, `authenticated` y
`service_role` no tienen acceso directo a las tablas; sólo las funciones
públicas acotadas, concedidas a `service_role`, operan el ledger. La política
restrictiva de Storage niega lectura y escritura de objetos del bucket a
clientes, incluso si existe otra política permisiva. El servidor nunca debe
aceptar un nombre de objeto enviado por el cliente: el namespace futuro se
derivará exclusivamente de `job.id`, `entry.id` y ordinal validados.

Una clave de idempotencia por actor y organización devuelve el mismo trabajo
si coincide paciente, miembro, fingerprint y cantidad esperada; un payload
distinto falla. Tomar un lease exige revisión exacta, autoridad actual y
lease libre o vencida. La revisión y el token protegen toda mutación futura
contra respuestas inciertas y trabajadores tardíos. Un fallo utiliza sólo
códigos fijos. El trabajo expira a las 24 horas y nunca será descargable
después de su vencimiento, aunque la limpieza esté pendiente.

**B06b1 no genera bytes ni ofrece transición a `READY`.** Las tablas de
entradas y fragmentos definen el contrato de verificación, pero ningún RPC
de este tramo permite registrarlos o declarar éxito. La autorización de
preparación B06b1 tampoco habilita descarga en estados `pending` o `leased`:
B06b2 exigirá explícitamente `state=ready`. B06b2 añadirá un
finalizador que compare inventario completo, lectura real de cada objeto,
tamaño y SHA-256 de todos los fragmentos, y autoridad actual antes de
marcar `READY`. Un documento retirado permanece en el inventario con cero
fragmentos y sin reactivar descarga. Una firma legada sin hash de origen
guardará `source_hash_kind=not_recorded`; el SHA calculado durante la entrega
no se presentará como hash histórico.

La limpieza futura será una operación privada acotada: `expire_due(1..50)`
identifica trabajos vencidos y el adaptador de B06b2 borrará **sólo** objetos
del bucket temporal bajo el prefijo derivado del `job.id`; confirmará
`cleaned_at` únicamente después de verificar el resultado. No se borran
documentos o firmas originales ni se instala un cron en B06b1.

El JSON v2, la exportación del portal y la UI siguen intactos. Este contrato
no promete una instantánea transaccional global, disponibilidad de archivos
retirados ni restauración acreditada. B06b2 tendrá que comparar el
fingerprint al final y fallar sin paquete parcial si cambian las fuentes.
