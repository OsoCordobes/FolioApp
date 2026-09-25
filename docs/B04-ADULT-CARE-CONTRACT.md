# B04 · Contrato de diseño para atención de adultos

Estado: contrato habilitado por A para preparar implementación y pruebas aisladas cuando se libere un escritor. Sin migración reservada, código, ejecución ni activación productiva. Diseño inicial sobre `2bdb60870caf8556f24a25db49e5ec1564b36003`; ahora se conserva en la copia del manager.

Nota de continuidad del 25/09: producción llegó a `987202afa3ae170061e0e121c09fedb911a7ffac`. A comparó M96, M106, M120 y los escritores `sesiones.ts`, `notas-clinicas.ts` y `clinical-write-context.ts` con la base del diseño: no cambiaron. Esto conserva la relevancia del análisis; no reemplaza la revisión de todas las rutas durante implementación. M128 ya fue utilizada para otro checkpoint; no reserva números ni autoriza activación.

## Decisión de A para avanzar sin bloquear el desarrollo

### Primer paquete B04a: fundamento de verificación, sin exigirlo todavía

Preparado el 25/09 sobre master `3c56a334d10911fc2f2c9c8269277bd883949e02`; volver a comprobar la base al asignar. Sólo migración aditiva, especificaciones SQL y documentación propias: revisiones monotónicas de fecha y vínculo, constancias privadas inmutables y RPC de lectura/atestación con comparación de versiones. No incluir todavía triggers que bloqueen inicios/notas, cambios de booking, interfaz, backfill ni activación. El resto de este contrato describe el checkpoint completo, no la autorización para ampliar B04a.

A fija para el ensayo que quien atestigua sea OWNER, DIRECTOR o PROFESIONAL, en todos los casos `es_colegiado`, miembro vigente y aceptado, con alcance clínico sobre ese paciente y acceso a su caja fuerte. ASISTENTE puede conservar su permiso demográfico anterior, pero no atestigua. La revisión clínica humana de fuentes y resolución de discrepancias sigue pendiente antes de exigirlo en atención real.

La atestación exige explícitamente JWT `aal2`, `allowed`, `hasVerifiedFactor` y `sessionValid` de `mfa_access_status()` verdaderos, además del usuario actual autenticado. A contrastó M101/M138/M139: `folio_mfa_private.assert_access()` por sí sola sólo obedece a la política global. Con la preparación apagada, incluso los tres booleanos pueden ser verdaderos para un JWT antiguo `aal1` cuya sesión DB fue elevada después; comprobar también el AAL del JWT. Pruebas negativas con política apagada: sin segundo factor y JWT `aal1` de la misma sesión elevada. M138 y llamadas clínicas M139 siguen la política global; M139 ya exige JWT `aal2` explícito al emparejar/revocar pantallas y para recepción. No alterar esas políticas como parte de B04a.

Aceptación de B04a: replay completo normal, negativa de lectura/escritura directa de constancias, roles/caja fuerte/organización revocados, comparación de versiones obsoletas, DOB y vínculo A→B→A, cambios demográficos ajenos que preservan la revisión y rechazo de revisiones manipuladas. Registrar por separado cualquier carrera real aún pendiente; no presentar una prueba secuencial como prueba de concurrencia. Revisión independiente A antes de publicar; ninguna migración nueva está reservada por este texto.

Se puede construir y probar el control con datos ficticios sin esperar una decisión humana. La preparación productiva será aditiva y la exigencia para nuevas atenciones tendrá activación separada, con lectura posterior; nunca se activará por instalar una migración. Las historias y consultas ya iniciadas deben conservarse según el contrato de abajo.

Para la prueba se utilizará una atestación explícita por un miembro con permiso clínico sobre la ficha y condición profesional acreditada en Folio; recepción no atestigua. Se registrará que el profesional comprobó la fecha y cuál fue la fuente, sin copiar documentos de identidad ni afirmar verificación material por software. El criterio provisional del 29/2 será el 1/3 en año no bisiesto y se cubrirá con pruebas de frontera. Son decisiones para diseñar y ensayar, no conclusiones jurídicas ni aprobación clínica del piloto.

Antes de exigirlo en pacientes reales quedará una revisión concreta y breve del responsable clínico: quién realiza la comprobación, qué fuente acepta el consultorio y cómo resuelve una discrepancia. No hace falta mantener detenido el desarrollo mientras se prepara esa revisión. No dar por terminada la atención adulta sólo por publicar código con el control desactivado.

## Regla de producto y límite comprobable

`docs/LAUNCH-BOARD.md` exige edad verificada de al menos 18 años antes de una atención nueva, conserva historias y correcciones históricas autorizadas, y limita el formulario público a una declaración explícita sin cambiar la identidad. La fecha de nacimiento sola no prueba verificación: `paciente_identidad.fecha_nacimiento` no tiene constancia vigente. La declaración pública tampoco la prueba.

El servidor debe rechazar de forma recuperable un inicio nuevo o una nota clínica nueva cuando falte fecha, verificación vigente o edad suficiente. En cada escritura nueva también exige organización activa, paciente vivo/no pseudonimizado e identidad vigente/no borrada, todos en la misma organización. Lectura, exportación, cierre y enmiendas de registros previos siguen disponibles. La restricción opera en base de datos para cubrir clientes directos además de la interfaz.

## 1. Inicio formal de turno

En `BEFORE INSERT OR UPDATE OF estado, paciente_id, organization_id ON turno`:

| Escritura | Contrato |
| --- | --- |
| `INSERT` con `NEW.estado = ATENDIENDO` | Exigir adulto verificado. M09 permite hoy ese estado inicial si `atendiendo_desde` acompaña. |
| `UPDATE` con `OLD.estado <> ATENDIENDO` y `NEW.estado = ATENDIENDO` | Exigir adulto verificado. M91 mantiene su matriz de transiciones; no se crea una salida de `CERRADO`. |
| `UPDATE` que conserva `ATENDIENDO` y paciente/organización | Continuidad: no repetir la puerta de inicio. |
| `UPDATE` de paciente u organización de un turno ya iniciado (`OLD.estado IN (ATENDIENDO, CERRADO)`), incluso junto con cierre | Rechazar la reasignación genérica. Una rectificación histórica de vínculo exigiría una ruta separada, explícita y auditada; `RESOLVE` de M120 no reasigna. |
| `CLOSE`, `RESOLVE`, lectura, sesión ya iniciada, enmienda | Conservar la semántica actual. |

M106 `SAVE` toma el turno `FOR UPDATE`, crea/actualiza la sesión y transiciona a `ATENDIENDO` dentro de la misma transacción. Si el guard rechaza esa transición, se revierte toda la escritura clínica y el editor conserva el borrador. `AUTOSAVE` exige turno ya activo. La prueba E2E llamada `reopenVisit` vuelve a abrir la **ficha para lectura** tras otro login; no transiciona `CERRADO→ATENDIENDO`. M120 `RESOLVE` mantiene `CERRADO`. No se inventa una excepción REOPEN. El log `transicion` puede probar qué pasó, pero **no** debe eximir de la puerta por tener una entrada antigua.

Antes de aceptar cualquiera de las dos entradas a `ATENDIENDO`, el guard comprueba `organization.deleted_at IS NULL`, `paciente.organization_id = turno.organization_id`, `paciente.deleted_at IS NULL`, `paciente.pseudonimizado_en IS NULL`, `paciente.identidad_id IS NOT NULL`, y `paciente_identidad.organization_id = turno.organization_id` con `paciente_identidad.deleted_at IS NULL`. La constancia debe coincidir con ese paciente, identidad y revisiones; no basta un evento viejo que todavía matchee la DOB. M09 `turno_same_org_guard` sólo comprueba pertenencia, y M106 protege su RPC, por lo que esta comprobación adicional cubre el INSERT/UPDATE directo. La edad se calcula en la fecha real de inicio, en `organization.timezone`, nunca con la fecha del turno ni el `current_date` de la conexión. Zona inválida: rechazo cerrado, sin fallback a UTC. La fecha de nacimiento y la constancia se leen bajo bloqueo hasta el commit. Falta fijar con A la regla explícita para nacimiento el 29/2 en años no bisiestos; propuesta conservadora: cumpleaños el 1/3, sin afirmación jurídica.

## 2. Fecha verificada, permisos y concurrencia

- Añadir revisión monotónica de DOB a `paciente_identidad` (`dob_revision`) y revisión monotónica del vínculo `paciente.identidad_id` (`identity_link_revision`). Fijar cero canónico en INSERT y rechazar revisión inicial ajena; en UPDATE calcular desde `OLD` y rechazar revisión manipulada, incluso si no cambió fecha/vínculo. No aceptar NULL, negativos ni desbordamiento; ante agotamiento del contador rechazar, nunca reiniciar. A→B→A no revive una verificación vieja; tampoco desvincular y volver a vincular la misma identidad.
- Guardar eventos de verificación inmutables en esquema privado: organización, paciente, identidad, ambas revisiones, `member` verificador, instante y fuente declarada. Sin copia adicional de la DOB ni texto clínico. El gate sólo acepta un evento que coincida con **el paciente, identidad y ambas revisiones vigentes**, además de DOB no nula y edad suficiente. Filas históricas quedan sin evento; no hay backfill ni presunción de verificación.
- La tabla privada no concede escritura ni lectura directa a `anon`, `authenticated` o `service_role` por API; el único escritor ordinario es una RPC `SECURITY DEFINER` con `search_path` fijado, MFA vigente, usuario y rol actual comprobados. Evento append-only con trigger contra `UPDATE/DELETE`. Auditar verificación y corrección; M12 ya audita los cambios de identidad completos, así que el nuevo evento no duplica PII.
- La acción staff lee la DOB y revisión actuales, solicita confirmación explícita de la fuente y, si cambia DOB, motivo. RPC con CAS para `identity_id`, `dob_revision`, `identity_link_revision` y DOB esperada (comparación `IS NOT DISTINCT FROM`, incluida NULL); conflicto devuelve revisión, no sobrescribe. Si cambia la DOB, el trigger incrementa revisión; luego la RPC inserta la constancia de esa revisión en la misma transacción. Cambio directo permitido por M03 invalida por revisión y no puede escribir constancia. Una edición de otros datos demográficos no invalida DOB.
- Rol propuesto para **atestiguar**: profesional con acceso a esa ficha, OWNER o DIRECTOR con acceso clínico, siempre MFA vigente. M03 permite a ASISTENTE editar identidad, pero esa edición no atestigua; COORDINADOR tampoco. A debe confirmar esta frontera operativa y qué fuente puede declarar el profesional. La interfaz no puede verificar materialmente un documento: registra la atestación responsable y su autoría.

Orden de bloqueo factible: M106 ya toma `turno FOR UPDATE`, luego sesión, organización, miembros, paciente e identidad `FOR SHARE`. El guard del turno hereda el bloqueo del turno; después toma organización, paciente, identidad y consulta la constancia en ese orden. La nota `NUEVA` no toma turno: organización → paciente → identidad → constancia; la corrección valida referencia previa del mismo paciente y organización después de bloquear la ficha, sin tomar turno. El RPC de DOB **no toma turno**: organización → miembro verificador (`FOR SHARE`, revalidando rol, aceptación y condición profesional bajo ese bloqueo) → paciente → identidad (`FOR UPDATE`) → inserción de constancia. Retener estos bloqueos hasta commit; una lectura inicial de permisos sin bloqueo no evita una revocación concurrente. El trigger de revisión de DOB no toma locks de paciente/turno tras adquirir identidad; sólo calcula `NEW.dob_revision`. El trigger de revisión del vínculo no toma identidad después de bloquear paciente. Revisar con carreras reales contra corrección de DOB y revocación del miembro antes de aprobar la migración; no presentar pruebas secuenciales como concurrentes.

Una identidad antigua con DOB adulta, pero sin evento, fallará en una nueva atención hasta que staff la confirme. Mostrar el motivo y el camino de verificación antes de la visita; jamás autoacreditarla durante la migración.

## 3. Nota libre nueva frente a corrección histórica

M96 `nota_clinica` es append-only y hoy sólo guarda paciente, autor, texto cifrado y `created_at`: no fecha del hecho, referencia ni motivo. Añadir columnas anulables, sin default ni UPDATE de filas previas: `tipo` (`NUEVA` o `CORRECCION`), `corrige_nota_id` y `motivo_correccion` de 10–500 caracteres. El vínculo debe señalar una nota existente, distinta de la nueva, del mismo paciente y organización. Se pueden encadenar correcciones conservando todas las versiones y sus autores.

En todo `BEFORE INSERT` de nota se exige organización activa, paciente vivo/no pseudonimizado e identidad vigente/no borrada de la misma organización; no se habilita añadir apuntes a una ficha pseudonimizada. `tipo NULL` (clientes antiguos) o `NUEVA` equivale a documentación nueva y exige adulto verificado; no puede llevar vínculo/motivo de corrección. `CORRECCION` exige vínculo y motivo válidos en DB, en la misma ficha y organización, pero no exige volver a verificar edad, pues corrige un registro existente. El texto cifrado no permite clasificar el acto ni verificar que la corrección sea semánticamente fiel: referencia, motivo y autor dan trazabilidad, con control humano como límite. Filas históricas con `tipo NULL` se leen como legado de clasificación desconocida; **no** se reclasifican retroactivamente. Para corregir una sesión ya existe `sesion_enmienda`, con `sesion_id` y motivo; no se sustituye por una nota suelta.

La UI ofrece “Corregir esta nota” desde una nota concreta y muestra referencia, fecha de **registro**, autor y campo motivo. “Nueva nota” sigue siendo el camino para una llamada, mensaje o recuerdo sin antecedente. Un adulto verificado puede documentar retrospectivamente en ese camino. Para menor o DOB desconocida sin nota previa, la nueva escritura queda bloqueada por el alcance adulto acordado; no se anuncia una excepción histórica inexistente. Lectura, PDF/exportación y enmiendas anteriores se preservan.

## 4. Reserva pública y experiencia de rechazo

En `/book/[slug]`, comunicar el alcance adulto y recoger declaración afirmativa independiente del consentimiento existente. Validarla en la acción del servidor e incluirla en el intento idempotente sin romper recibos anteriores; la revisión exacta del orden de lectura de recibo e hash pertenece a la implementación. No pedir DOB en el formulario público ni sobrescribir `paciente_identidad` al reservar. Una reserva puede existir sin DOB; staff debe verificar antes de iniciar. Un rechazo del inicio o de nota nueva mantiene borrador y ofrece verificar/corregir DOB desde la ficha; no reintentar a ciegas ni sugerir que la reserva confirmó edad.

## 5. Aceptación y complejidad relativa

| Pieza | Alcance aproximado | Complejidad relativa |
| --- | --- | --- |
| Migración aditiva y SQL specs | Revisiones, eventos privados, RPC, guards de turno/nota, permisos y errores | Alta; bloqueante para el resto. |
| Staff DOB | Lectura, corrección/atestación con CAS, estados recuperables y auditoría | Media-alta; depende del contrato DB. |
| Notas | Contrato, acción y UI de corrección vinculada, lectura legible de legado | Media; depende del guard DB. |
| Booking | Declaración, contrato de acción e idempotencia de recibo | Baja-media; independencia funcional parcial. |
| Integración y evidencia | Ajustar fixtures sintéticos y pruebas de carrera, zona, navegador y gates del repo | Alta; puerta obligatoria de aceptación. |

No hay estimación calibrada de tiempo, cuota o ciclos Codex. El camino crítico es contrato DB → migración y specs → staff/notas → pruebas integradas; booking puede prepararse en paralelo una vez fijado su contrato. La referencia original a reservar M128 quedó superada: se elegirá el siguiente número y timestamp disponibles al asignar implementación. No aplicar ni activar en producción desde este documento.

Matriz mínima de pruebas:

| Caso | Resultado requerido |
| --- | --- |
| Adulto verificado, 18 cumplidos en fecha local | INSERT directo permitido y M106 SAVE inicia una sola vez. |
| Menor, DOB NULL, adulto sin constancia, constancia vieja tras DOB A→B→A o vínculo A→B→A | Inicio y nota nueva denegados; sesión/borrador intactos. |
| Organización borrada, paciente borrado/pseudonimizado, identidad NULL/borrada o de otra organización, aun con evento previo | INSERT/UPDATE directo a ATENDIENDO y toda nota nueva denegados; corrección de nota no escribe sobre ficha pseudonimizada. |
| Directo `UPDATE` a `ATENDIENDO`; intento de cambiar paciente/org de turno activo o cerrado | Gate en el primer caso; reasignación genérica denegada. |
| M120 CLOSE/RESOLVE, consulta cerrada, lectura PDF/exportación y `sesion_enmienda` | Siguen disponibles sin revalidar edad. |
| Nota libre legacy sin `tipo`; nueva explícita; corrección misma ficha; referencia ajena, inexistente o motivo ausente | Dos primeras exigen adulto; corrección válida pasa; referencias/motivos inválidos se rechazan. |
| Direct REST de constancia, rol no autorizado, MFA ausente, CAS con DOB NULL o versión obsoleta | Rechazo sin evento ni cambio silencioso. |
| Inicio contra corrección DOB simultánea; nota contra corrección DOB simultánea | Resultado coherente con un orden de commit: usa estado verificado vigente o rechaza; sin deadlock ni aceptación de verificación caduca. |
| Medianoche entre UTC y zona de clínica; día previo y exacto a 18 años; 29/2; zona inválida | Edad correcta según regla aprobada; configuración inválida falla cerrado. |
| Fixtures M96 y M116 actuales | Darles DOB adulta sintética y constancia donde ejercen nueva escritura, sin cambiar historias reales ni relajar negativos de permisos. |
| CI del candidato implementado | `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`, SQL completo, navegador y comparación del SHA exacto. |

Fuera de B04: autorizar atención nueva a menores, rectificar vínculo de un turno cerrado por UPDATE genérico, inferir edad desde declaración pública, reconstruir retrospectivamente eventos de verificación, certificar el contenido de un documento de identidad por software, y cualquier despliegue/merge de PR168.
