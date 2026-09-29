# C — Continuidad, proveedores y soporte

**Corte:** 29/09/2026 18:58 UTC. **Resultado:** la tarea horaria sigue activa, pero no publica una copia válida desde el 19/09: el intento actual se detiene en `tool_version/tool_unavailable`. Sólo se leyeron metadatos, manifiestos públicos y estado de Windows; no se abrieron DPAPI, sobres, artefactos cifrados ni datos clínicos, y no se iniciaron capturas, restauraciones, servicios, envíos, cargos o compras.

Fuentes de coordinación: [tablero vigente](C:/Users/amiun/.codex/worktrees/folio-launch-manager/folio-app/docs/LAUNCH-BOARD.md) e [informe legal L2/L3/L6/H3](C:/Users/amiun/.codex/worktrees/ae38/folio-app/docs/LAUNCH-LEGAL-SEO-PERFORMANCE.md).

## Evidencia y frontera real

| Frente | Confirmado | Pendiente para cerrar |
|---|---|---|
| **Captura** | Tarea `Ready`; última ejecución `2026-09-29T18:57:11Z`, resultado `20`. `scheduled-backup-last-status.json`: `checkpoint_incomplete`, `failed`, `stale24h=true`, 243,52 h. `last-success.json`: copia `backup_20260919T152420749Z_b7c7b14b-2c92-4674-84bb-a2953db9ce80`, completada `2026-09-19T15:27:05.431Z`, con verificación enlazada. | Nueva copia autenticada y enlazada; conservar fallos. La hora de la tarea no es fecha de respaldo. |
| **Diagnóstico** | `backup-diagnostics/*.json`: 242 registros `tool_version/tool_unavailable` entre 13/09 y 29/09. Los `.incomplete_*` recientes están vacíos. `pg_dump.exe`, `pg_dumpall.exe` y DLL existen en `%LOCALAPPDATA%/FolioTools/postgresql-17.11/pgsql/bin`; presencia no prueba ejecución. | Distinguir bloqueo, ACL, dependencia o entorno sin descifrar el detalle sellado ni contactar Supabase. |
| **Restauración** | C01 probó un recorrido **sintético** e integrado en PR167; [RESPALDOS.md](RESPALDOS.md) documenta sus límites. | No hay restauración productiva acreditada. No repetir C01 por rutina. |
| **Custodia** | `passphraseStoredSeparately:false`, `ownerCustodyPending:true`; [RECUPERACION-CLAVES.md](RECUPERACION-CLAVES.md) confirma dependencia del perfil DPAPI. | Responsable, custodio alterno, frase separada y medio portable fuera de esta PC, con hashes y acceso ensayados. |
| **Alerta** | Se pidió aviso por antigüedad, pero figura `deduplicated` y `userSeen=false`. | Primario, suplente, canal comprobado y escalamiento al superar 24 h o fallar. |

**Diagnóstico acotado:** los intentos crean el contenedor y fallan al comprobar la herramienta PostgreSQL, antes del dump y de la autenticación. La causa de sistema operativo sigue abierta; estos metadatos no permiten atribuirla a red, credenciales ni proveedor.

## Paquetes operativos, en orden

1. **R0 · captura local — siguiente paquete.** Con autorización, ejecutar sólo `--version` de `pg_dump`/`pg_dumpall` bajo el entorno exacto de la tarea, sin DPAPI ni red. Si falla, registrar código cerrado, ACL y eventos de Windows; preparar herramientas en un directorio nuevo contra el ZIP 17.11 y SHA de [RESPALDOS.md](RESPALDOS.md), sin reemplazar lo vigente. Revisar hashes, `Plan` e `Inspect`; sólo después autorizar un `Update` y **un** `CatchUp`. **Cierre:** ID posterior al 19/09, verificación enlazada, `last-success.json` actualizado, `exitCode=0`, edad menor de 24 h y fallos preservados.
2. **H2/H3 · custodia/retención.** Titular define primario, suplente, medio externo y frase separada; asesoría define dato→custodio→plazo→destino tras baja. **Cierre:** recibo sin secretos con fecha, clase de destino, hashes, responsables y lectura íntegra desde el medio. La política actual conserva siete días y cuatro semanas representados; no garantiza 30 copias diarias.
3. **L6/H3 · proveedores.** En lectura de consolas/contratos, registrar para Supabase, Vercel, Upstash, SMTP, Google, Mercado Pago, Cloudflare/Turnstile y Maps: datos, estado, país/región observada, contrato/garantía, subencargados, retención, cuota/alerta y responsable. Código, variable o despliegue no lo prueban. **Cierre:** cada afirmación pública tiene evidencia fechada; lo no verificado queda pendiente. C03 sigue apagado; C04/C05 esperan ensayo externo.
4. **L2/C06 · ayuda/derechos.** `lib/support.ts` publica `folioasistencia@gmail.com`, sin prueba de recepción o capacidad. Asignar primario/suplente y separar cuenta, acceso, rectificación/supresión, copia clínica e incidente. Después, ensayo sintético autorizado de recepción, asignación, derivación y entrega, sin PHI. **Cierre:** procedimiento comprobado con 10 días corridos para acceso, 5 hábiles para rectificación/supresión procedente y 48 h para copia clínica, incluso con suscripción suspendida.

Hasta cerrar R0, reportar **respaldo vencido con captura fallida**. C01 no acredita restauración productiva; DPAPI no acredita custodia portable; el aviso solicitado no acredita lectura humana.
