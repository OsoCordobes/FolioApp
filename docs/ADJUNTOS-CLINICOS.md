# Adjuntos clínicos: primer piloto (B2 / M102 + M104)

Estado: implementado y verificado localmente con datos sintéticos. No aplicado a producción. El paquete exportable de historia clínica todavía no incluye los archivos binarios adjuntos.

## Comportamiento

- Nuevas subidas: máximo **4 MiB por archivo**. La acción recibe el archivo, verifica sesión/MFA, rol clínico, paciente visible por RLS y sesión correspondiente, inspecciona bytes y sólo entonces usa Storage con privilegios del servidor. El nombre y MIME enviados por el navegador no deciden el formato.
- Formatos reconocidos: PDF, JPEG, PNG, WebP, HEIC, TIFF y DICOM Part 10 con metadatos. Es una inspección de firmas y estructura básica del contenedor; no es antivirus, decodificación completa ni validación médica. Archivos desconocidos, truncados o sin cabecera compatible requieren revisión.
- El registro vuelve a descargar los bytes, contrasta tamaño/MIME, calcula SHA-256 y vuelve a comprobar autorización antes de persistir. Una subida fallida sólo elimina el objeto recién generado si se confirmó que no existe registro; ante resultado incierto conserva el objeto privado para revisión.
- La interfaz recibe `/api/documentos/{id}/archivo`. Cada GET/HEAD verifica sesión/MFA, rol, documento y paciente por RLS antes de descargar, valida los bytes y vuelve a comprobar acceso antes de responder. Otro consultorio, paciente fuera de alcance, caja fuerte ajena y documentos retirados no habilitan la descarga.
- Las respuestas son privadas, sin caché compartida, con `nosniff`, CSP restrictiva y nombre generado. Sólo PNG/JPEG/WebP se muestran inline. PDF y los demás formatos se descargan. Range admite un intervalo; también requiere autorización completa.
- Archivos históricos: se conservan las filas y objetos. Se admite lectura hasta 50 MiB, con validación de tamaño y MIME incluso sin hash. Se valida el archivo completo en memoria antes de entregar una respuesta streaming; no es una lectura parcial desde Storage. Los incompatibles se rechazan sin borrarlos.
- Después de su activación explícita, la política restrictiva de M104 bloquea para `anon`/`authenticated` el acceso directo al bucket `documentos-clinicos` y la inserción/modificación directa de metadatos. **Instalar M104 sola no cierra ese acceso.** No cambia el bucket de consentimientos. Los lectores de metadatos siguen sujetos a las políticas de paciente/caja fuerte existentes.

## Instalación y comprobaciones previas

M102 y M104 se instalan antes del código. El borrador M104, que nunca fue aplicado a producción, usa una política privada inicialmente apagada para permitir el rollout de toda la cadena M98–M115 sin una release puente:

1. Aplicar **M102**: columnas opcionales, verificación de coherencia e índice sólo para registros validados. Conserva las políticas de lectura/subida de la interfaz anterior; los registros sin hash siguen permitidos durante esta fase.
2. Aplicar **M104** (`20260908174149_M104_clinical_attachments_enforce.sql`) y continuar las demás migraciones en orden. `folio_attachments_private.policy.enabled=false`: las políticas restrictivas conservan las operaciones legadas que ya autorizaba RLS. No cambia ni completa hashes de registros antiguos. Esta etapa todavía no protege contra el SDK directo autorizado legado.
3. Desplegar el código nuevo y hacer smoke sintético de subida válida/inválida, descarga autenticada, caja fuerte y cuenta ajena. La interfaz nueva no emite enlaces firmados ni utiliza escrituras directas.
4. Un operador autorizado llama `public.enable_clinical_attachments(p_reason, p_build_sha, p_reference)` con rol de servicio o administración directa: motivo de 20–240 caracteres, SHA completo del build desplegado (40 caracteres hexadecimales minúsculos) y referencia de revisión de 8–120 caracteres (`A-Z`, dígitos, `_`, `.`, `:`, `-`). No incluir PHI, URLs privadas ni secretos. La activación es unidireccional, bloquea la fila y registra fecha, actor SQL, motivo, build y referencia en política e historial privados. Un reintento conserva el primer registro; no existe una operación de desactivación.
5. Confirmar que SDK/read/sign/upload directos y escrituras directas de metadatos fallan, mientras la aplicación sigue funcionando. Revisar el recibo privado con administración autorizada. OWNER, campos de perfil/metadata, variables de sesión y REST autenticado no pueden cambiar el interruptor. Service_role sólo tiene acceso a la RPC, sin permisos directos sobre las tablas privadas.

No declarar efectivo el cierre antes de activar M104. Antes de activarla se conserva compatibilidad de código legado; después un rollback debe mantener las rutas autenticadas o suspender adjuntos mientras se corrige. No restaurar permisos directos silenciosamente. Un administrador de base con poderes de propietario sigue siendo una autoridad privilegiada, fuera del modelo de amenazas de usuarios REST; su intervención debe estar controlada operacionalmente.
Antes de instalar, con operador autorizado y sin copiar contenido clínico, revisar únicamente identificadores y conteos de anomalías:

```sql
SELECT d.id
FROM public.documento_clinico d
LEFT JOIN public.paciente p ON p.id=d.paciente_id AND p.organization_id=d.organization_id
LEFT JOIN public.member m ON m.id=d.subido_por_id AND m.organization_id=d.organization_id
LEFT JOIN public.sesion s ON s.id=d.sesion_id AND s.paciente_id=d.paciente_id AND s.organization_id=d.organization_id
WHERE p.id IS NULL OR m.id IS NULL OR (d.sesion_id IS NOT NULL AND s.id IS NULL)
 OR d.storage_bucket <> 'documentos-clinicos'
 OR split_part(d.storage_path,'/',1) <> d.storage_bucket
 OR split_part(d.storage_path,'/',2) <> d.organization_id::text
 OR split_part(d.storage_path,'/',3) <> d.paciente_id::text
 OR d.storage_path !~ '^documentos-clinicos/[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.[A-Za-z0-9]{1,12}$'
 OR strpos(split_part(d.storage_path,'/',4),'..') > 0;
```

Los CHECK `NOT VALID` evitan escanear/rechazar filas históricas al instalar, pero sí se evalúan en escrituras nuevas y actualizaciones de esas filas. No ejecutar `VALIDATE CONSTRAINT` hasta resolver casos históricos con una revisión autorizada. La migración no debe ignorar errores de propiedad/permisos al crear la política de Storage: un fallo deja el despliegue detenido.

La aplicación fija el límite de Server Actions en 4.25 MB para el archivo de 4 MiB y su formulario. [Vercel limita el cuerpo de una función a 4.5 MB](https://vercel.com/docs/functions/limitations); comprobar en preview el margen real de multipart. Las respuestas de archivos históricos usan [streaming](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions), que necesita una prueba de extremo a extremo en el despliegue objetivo.

Los enlaces firmados emitidos antes del cambio **no se revocan retroactivamente** por cambiar esta interfaz o cerrar nuevas firmas. Supabase documenta que los [enlaces firmados siguen válidos hasta su vencimiento](https://supabase.com/docs/guides/storage/serving/downloads) y que [CDN puede conservar respuestas](https://supabase.com/docs/guides/storage/cdn/smart-cdn). Antes del piloto, revisar la exposición y TTL de enlaces anteriores con el operador; no afirmar que estas migraciones los invalidaron.

## Evidencia y límites

- `tests/unit/clinical-attachments.test.ts`: módulos reales de subida/registro/descarga y ruta; sólo framework, sesión y Supabase simulados. Cubre contenido falsificado, tamaño, ámbito, rol, revocación durante lectura, hash, rutas privadas, Range y fallo de transporte.
- `tests/unit/clinical-file-response.test.ts`: respuestas, cabeceras, rangos, rutas y contenedores truncados.
- `tests/sql/M102_clinical_attachments.spec.sql`: activa M104 dentro de una transacción que revierte al terminar y prueba Storage, metadatos, caja fuerte, consistencia relacionada, validación parcial y rutas. `M102_attachments_expand.spec.sql` demuestra lectura/firma, subida y registro antiguo sin hash con las políticas instaladas, sin eliminarlas para fabricar compatibilidad. `M104_attachments_rollout.spec.sql` comprueba instalación apagada, ACL/OWNER/anon/metadata, validación del build/referencia, activación e idempotencia, y cierre efectivo incluso con GUC falsificado. No modifica M102 ni M101.
- `.flow/attachments-review/run.cjs`: navegador Chromium con galerías reales en React StrictMode de desarrollo y bundle de producción; rechazo de miniatura, reintento limitado y subida interrumpida sin bloquear el siguiente intento. Sólo HTTP y acciones sintéticas.
- No se ejecutó una integración HTTP contra un backend Supabase Storage real. El catálogo SQL demuestra el cierre de políticas, pero no certifica upload/download HTTP, límites de Vercel, CDN ni todos los visores de imágenes. Requiere prueba sintética de preview con cuentas separadas, MFA, caja fuerte y archivo cercano al límite; no usar datos reales para esa prueba.
- No hay cuotas globales, cola antivirus, exportación de binarios ni limpieza automática de objetos huérfanos en este corte.

Revisión de integración M104: la prueba de instalación falló con el cierre inmediato anterior y pasó con el interruptor apagado. Replay limpio hasta M104: **98 migraciones con checks por defecto y 40 specs SQL PASS** (`.flow/m104-rollout-fresh.log`). La prueba adicional de fallo al guardar el recibo confirma rollback de política y estado del bucket (`.flow/m104-rollout-atomic.log`). No certifica HTTP Storage real ni una activación del destino. Las reglas de [permisos/RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) y [privilegios de funciones](https://supabase.com/docs/guides/database/functions) se contrastaron con la documentación oficial.
