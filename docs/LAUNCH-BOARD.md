# Folio — tablero único de lanzamiento

Actualizado el 25/09/2026. A dirige, revisa y publica. [AVANCES.md](AVANCES.md) es la vista breve para el titular, servida en `http://127.0.0.1:4420/`; cada fila cambia sólo ante un resultado significativo.

El [historial íntegro anterior](LAUNCH-BOARD-HISTORY-20260925.md) se conservó sin alterar. Copia exacta fuera de Git: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/launch-board-history-exact-20260925.md`, SHA256 `4E44550C8530E6C5B65E2AA4D8B81D85437DF342AA53F35356FD32BC7001C49C`. Contiene diagnósticos, fallos, autorizaciones, publicaciones y planes sustituidos. Este archivo gobierna el estado vigente; las fechas y estados históricos no vuelven a abrir trabajo ya cerrado.

## Estado de publicación

- **Master y Escritorio:** `0684eab324c7699dafadfab56f65a13d737069e7`, squash PR179 del 25/09 a03:57:23 UTC. Árbol `e7c8d2eff0c0252b45bd8768becf3b9b220ac903`, idéntico al candidato `640320302321af2332acd064c0598e7a112d44ad`. Escritorio tracked limpio; archivos ajenos conservados.
- **Producción:** Vercel `dpl_8pZz6SyrgDQw2FiMKXW1wK3WDVJ5`, READY03:59:40.023 UTC, Git/master/gru1, raíz y www. HTTP04:00:17.711: health/login200, Hoy anónimo307 a login, www308 al raíz. Esto acredita disponibilidad básica, no el lanzamiento completo.
- **Base de datos:** 131 migraciones canónicas, incluida M139. Se aplicó antes del merge, una vez, con COMMIT confirmado y lectura desde otra conexión. No reaplicar migraciones instaladas ni cambiar historias de activación.
- **CI PR179:** candidato App36091645985, SQL36091645977 y Preview `hpnghafftzdqvdifxcrn` PASS. Access36091645956 terminó SUCCESS antes del intento de cancelación; no se registra como cancelado. Squash SQL36092456414 y App36092456315 PASS; App terminó04:03:45 UTC.
- **Evidencia PR179:** `C:/Users/amiun/Documents/Codex/folio-b10-evidence/pr179-publication-final-0684eab.json` (SHA256 `C91C3C13C28735E6EC1107A72267F7DBFFD24CD811DCF5240CAA3AD756680AC7`); instalación `pr179-m139-apply-2026-09-25T03-56-43.025Z.json`, SHA256 `DB091B70922223132A5974591CD8430A6B77B52BE697DA5937A2E890F39190F4`. La interfaz del llamador todavía no está publicada.
- **PR178 cerrada:** squash `987202afa3ae170061e0e121c09fedb911a7ffac`, M137/M138, Vercel READY y App/SQL del squash PASS. Evidencia `C:/Users/amiun/Documents/Codex/folio-b06-evidence/pr178-publication-final-987202a.json`, SHA256 `4423BC4ED82EA55D8AE0924D5BBF33F8B30A7261E8A9C6F95489D2952B669B26`. Archivos verificados en ensayo Auth/DB/Storage36090170105; todavía falta la descarga completa desde la aplicación.
- **Última mejora visible:** PR177 conserva servicios del onboarding Solo/Clínica al volver y ante respuesta perdida. Trece etapas reales aisladas PASS; publicación cerrada en `C:/Users/amiun/Documents/Codex/folio-b01-evidence/pr177-publication-final-e7de042.json`, SHA256 `A874DFCB46369DD29D5709E6BA21A3044321A5B7C397ED3D1E065F61BE0BFB3A`.

## Equipo y siguiente integración

Máximo dos escritores de implementación en copias aisladas. A hace revisión independiente, coordinación y publicación; los agentes no amplían campañas. Implementación Sol High; dirección y decisiones delicadas Astra High. La existencia de una tarea en la barra lateral no demuestra actividad: comprobar estado y propiedad antes de asignar.

| Paquete activo | Responsable y copia | Alcance, dependencia y cierre |
|---|---|---|
| B06b3a · API de entrega | C `c01_restore_storage`; `C:/Users/amiun/.codex/worktrees/folio-export-delivery-api/folio-app`, rama `codex/launch-export-delivery-api` | [PR180](https://github.com/OsoCordobes/FolioApp/pull/180), candidato `28eb7ab0b013c9225ae9110c5b505d2c2fb0cc6e`, árbol `b47f14b1c478db83adbcc7cd17620de15198ab42`, limpio y congelado. Revisión A conforme;23 focales/typecheck/lint PASS. SQL36094140294 y Preview `pglzzmicbefbxwppmldy` PASS; App36094140273 pendiente. Access36094140288 y paquete36094140325 CANCELLED por repetición ajena al delta; reusar pruebas177/178 con límites explícitos. M140 todavía no productiva. RED cuatro fallos preservado `b06b3a-red-uncertain-read-audit-20260925.log`, SHA256 `E85ED10909723B17C4DE447CB58CF9CF51B694A7627697EBF98CF691DDDB2076`; GREEN23 SHA256 `3AAE0C4678C5B1797F76B3C839A432E0AAED225A1559036DA70C4A0C7F3BCD54`. HTTP completo/UI siguen aparte. |
| B10b · pantalla y controles | D `miniweb_design_plan`; `C:/Users/amiun/.codex/worktrees/folio-reception-screen/folio-app`, rama `codex/launch-reception-screen` | Base inicial18d40299. Controles en Hoy, configuración descubrible, emparejamiento y pantalla. M141 `20260925035905_M141_caller_screen_list.sql` sólo local para listar/revocar credenciales tras recargar. Antes del primer push integrar candidato M140 estable de C. M141 permisos/DTO revisados por A; ajustar paginación durable. Interfaz y handlers escritos, typecheck/lint/focales PASS según D; A encontró intención perdida al recargar, respuesta malformada sin marca incierta, reset audible y Retry-After recortado. D corrige y amplía prueba específica antes del primer push. UI/HTTP/navegador real y revisión visual pendientes; sin activación de proveedores. |

- C es dueño de `app/api/patient/export-package/**`, helpers de entrega, M140/spec y pruebas propias. No recibe fingerprint, conteo ni rutas privadas desde el cliente. Token de lease sólo en memoria; tras pérdida se consulta estado y se espera vencimiento antes de reclamar explícitamente el mismo trabajo.
- D es dueño de caller/Hoy/pantallas y CSS acotado, M141/spec y runner de prueba propio. También es dueño exclusivo de agregar `folio_caller_proof` a la lista exacta del puente CI; C no toca ese helper mientras D trabaja.
- Operador M140 preparado por A y revisado independientemente por C: `folio-b06-evidence/apply-pr180-m140.mjs`, SHA256 `B8A4D4A766D8605BD7331CC485DDE1E3ED8DD16BB369A0F3B4D295950DF55C05`;6 guardas offline PASS y cuatro funciones verificadas contra catálogo real Preview (`preview-m140-target.json`, SHA256 `E87E1B99D0150E7EFB5A41035D53BF816646EF5DDD72A7DFAEB75432081A2C16`). Sin aplicación aún.
- M139 es inmutable y ya productiva. M140 precede a M141. No publicar una rama con migraciones faltantes o reaplicar por cambios de base; comparar árbol/candidato y ledger actual.
- C prepara B06b3b en `C:/Users/amiun/.codex/worktrees/folio-export-delivery-ui/folio-app`, rama `codex/launch-export-delivery-ui`, base exacta28eb7ab. Propuesta de archivo único y ensayo HTTP Auth/DB/Storage; la copia de PR180 queda congelada. A revisa el formato antes del ensamblado.
- Siguiente entrega completa de exportación exige HTTP/UI y un camino para obtener el conjunto íntegro sin decenas de clics ni descargas parciales. B06b2 y una colección de enlaces no cierran ese resultado.
- B04 tiene [contrato preparado para implementación aislada](B04-ADULT-CARE-CONTRACT.md); se asignará cuando se libere un frente. B09 tiene [contrato de aporte y revisión](B09-PATIENT-FORM-CONTRACT.md). Ninguno reserva otra migración.

## Lista de checkpoints, sin semanas obligatorias

Selección por riesgo, dependencia, utilidad y esfuerzo restante. Terminar, comprobar, entregar y elegir el siguiente trabajo útil. Estados distintos: defecto reproducido, hipótesis, evidencia pendiente, decisión humana, probado y publicado. Una prueba parcial no cierra el checkpoint global.

| Checkpoint | Estado actual | Condición de cierre |
|---|---|---|
| Recuperación completa · C01 | Ensayo integral sintético aprobado e integrado PR167; custodia externa aparte | Recuperar DB, datos cifrados, archivos, contraseña/MFA y aislamiento. Evidencia36073216478; no repetir por rutina ni afirmar restauración de producción. |
| Permisos y privacidad · B05 | PR170/174 publicadas; alcance global aún requiere revisión final | Roles, organizaciones, acceso directo, archivos, consentimiento y revocación respetan el alcance autorizado. |
| Ingreso y onboarding · B01/B02 | PR175/177 publicadas y probadas | Registro, confirmación, recuperación y Solo/Clínica sin reparación manual; salir, volver y completar después. |
| Recepción · B03 | PR172 publicada y ensayo36076854795 PASS sin omisiones | Agenda y llegada para Asistente/Coordinador según alcance; operaciones administrativas no inician atención. |
| Atención adulta · B04 | Contrato preparado; implementación y decisión clínica pendientes | Proteger nuevas atenciones; conservar historias, consultas iniciadas y correcciones autorizadas. Activación separada de instalación. |
| Miniweb profesional · D06 | PR171 publicada y revisada en móvil/escritorio | Plantilla Folio, dos disposiciones, dirección/mapa confirmado, servicios/reserva; página de clínica y enlace individual con permiso propio. Editor sencillo y completar después. |
| Ficha del paciente · B09 | Contrato preparado, sin código | Enlace/QR, datos/motivo y 5–10 preguntas aprobadas por especialidad. Personal autorizado revisa e incorpora sin reescribir ni sobrescribir silenciosamente. |
| Llamador · B10 | Base PR179 publicada; B10b en construcción | Código/destino sin datos personales, pantalla limitada/revocable, estado de conexión y reconexión silenciosa; llamar no inicia consulta. |
| Google Calendar · C05 | Evidencia externa pendiente | Folio gestiona turnos y los refleja; eventos externos bloquean horarios. Cambios y reintentos no duplican. |
| Correo · C03 | Entrega global desactivada; evidencia pendiente | Buzones controlados, errores visibles, entrega/reintentos sin duplicados, enlace de ficha el día del turno. |
| Pagos/suscripciones · C04 | Evidencia externa pendiente | Solo/Clínica, asientos, pendientes, mora, cancelación y conciliación con respuestas interrumpidas y eventos desordenados. |
| Portal y exportación · B06 | PR173/176/178 publicadas; entrega completa en construcción | Adulto autorizado obtiene sus datos y archivos íntegros. Distinguir inventario, archivo entregado y documento retirado. |
| Continuidad/soporte · C02/C06 | Evidencia y responsable externo pendientes | Respaldo/material portable fuera del perfil Windows, alertas, responsables, capacidad inicial y procedimiento de ayuda comprobados. |
| Validación/piloto · H01/L01 | Pendiente humano y operativo | Cinco especialidades;14 días,3 profesionales, al menos5 jornadas por persona y cero problemas graves pendientes del alcance. |
| Lanzamiento · L02 | Pendiente | La versión publicada coincide con la probada y la oferta comercial/soporte con lo que realmente funciona. |

## Decisiones de producto que no deben perderse

- Lanzar Solo y Clínica, cinco especialidades, Google y portal para adultos. Empezar con pacientes nuevos. Menores, WhatsApp automático, agentes operativos y traslado histórico de Coofit van después. No contactar a Coofit ni inventar compatibilidad de importación.
- Miniweb: una plantilla seria de Folio violeta con datos, fotos/logo y textos reales del profesional/clínica. Dos disposiciones, Perfil y Consultorio; sin selector decorativo de color, logo viejo marrón ni identidad inventada. Cambiar dirección requiere reconfirmar mapa; una falla del mapa conserva dirección y reserva. Mismos datos/componentes en vista previa y publicación. El enlace propio de cada profesional autorizado ya fue publicado en PR171.
- Ficha: credencial limitada al turno, temporal y revocable, sin cuenta Auth ni lectura de ficha previa. Respuestas cifradas/versionadas, procedencia del paciente, revisión administrativa separada de clínica. Omitido no equivale a No; no fusionar identidades. No obstaculiza atención. Correo el día del turno, dos horas antes dentro del mismo día; reservas posteriores, al confirmar. Enlace manual y QR tras cotejo mientras la entrega automática no esté comprobada.
- Llamador: código y destino, sonido breve opcional tras gesto humano, nunca nombre/motivo/pago/historia. Pantalla con credencial independiente, no sesión del profesional. Cookie host-only HttpOnly/Secure en producción, Path acotado; no token en URL, almacenamiento web o telemetría. Sondeo visible5s sin solapamiento, suspendido al ocultarse; errores limpian datos, reconexión silenciosa. Listado staff paginado sin secretos y revocación durable.
- Google: los turnos se administran en Folio; reservas confirmadas se reflejan y eventos ajenos bloquean disponibilidad. No crear pacientes interpretando títulos ni anunciar edición bidireccional desde Google.
- Preguntas clínicas, criterio de verificación para adultos, responsable/destino de custodia y piloto requieren decisiones humanas concretas. Preparar y probar lo independiente; no fingir aprobación clínica ni detener todo el desarrollo por ellas.

## Cuota, autonomía y continuidad

Última lectura real:21% usado/79% disponible; reserva15%. Reinicio informado por la herramienta:01/10/2026 21:27:44 UTC, cero créditos. No presumir reinicio el sábado26/09. No atribuir consumo exacto a cada agente ni convertir cuota en horas garantizadas.

Al llegar a85% usado, no abrir implementación nueva: cerrar paquetes revisables, preservar evidencia y dejar continuación. La calidad y los criterios gobiernan el cierre; no consumir cuota artificialmente ni repetir pruebas verdes sin cambio, fallo o duda concreta. El titular autorizó continuar autónomamente mientras duerme; pedir sólo decisiones indispensables y seguir con trabajo independiente.

Heartbeat `folio-manager-por-checkpoints`: respaldo horario silencioso ante interrupciones, no ritmo de trabajo. No terminar el turno para esperar su próxima activación mientras haya trabajo útil autorizado. Verificar cuota/cupo/agentes antes de reanudar; no duplicar escritores. No modificar el recordatorio de copia semanal. Este tablero, las copias y la evidencia permiten relevo de manager si hace falta.

Entrega al titular: qué mejoró, evidencia breve, dónde probarlo y qué falta. Al detenerse, cuatro o cinco párrafos sencillos con la razón real y pasos concretos en la aplicación. El panel4420 permanece disponible.

## Disciplina operativa y checkpoint que no se repite

- PR165 cerrada: master `c5c5fed53f5b72dbebb604c1812b25c54a5d23b7`, candidato `58f534bb9bb735965b2b6c177fd849c3eec5d775`, árboles iguales. Ensayo `hosted-smoke-evidence/2026-09-19T17-53-48.159Z-d7d715794d6c45b6.json` aprobado; fallo final-off anterior preservado. No repetir su recorrido ni reactivar M106/M120/M121 ni cambiar sus motivos históricos. No se ejecutó RED del componente anterior.
- Master autodespliega; Supabase Git aplica pendientes. Migración aditiva antes del código; cierre/enforcement en publicación separada cuando exige código nuevo. PR170 demostró que juntar expansión y cierre puede anticipar el cierre: no repetir esa secuencia. M129 conserva sus cinco sentencias canónicas.
- Producción131 versiones a M139, incluidas M125/M126/M127/M128/M129/M130/M132/M133/M134/M135/M136/M137/M138. Los borradores no aplicados siguen conservados en el historial; los IDs no reemplazan las versiones canónicas. Releer ledger antes de cualquier nueva instalación.
- No iniciar/resetear/prunear Docker local ni borrar bases, volúmenes, worktrees, fixtures, respaldos, informes o archivos ajenos. Usar entornos efímeros autorizados y datos sintéticos para pruebas. No repetir una escritura cuyo resultado es incierto: primero lectura nueva.
- No envíos, compras, cargos reales, activación Google ni cambios ciegos en MFA/consentimiento/adjuntos/población/disponibilidad. La entrega global de correo sigue apagada. Preparar las acciones sensibles externas para autorización concreta; no inferirlas de un ensayo local.
- Mantener el par Upstash reparado; el sobre original contiene el par viejo y no debe restaurarse encima. DPAPI depende del perfil Windows y no acredita custodia portable externa. Nunca imprimir secretos. Preservar `.env.local` antes de herramientas que puedan escribir configuración.
- Operadores: bytes SQL/HEAD/árbol fijados, preflight de sólo lectura, comparación dentro de transacción, COMMIT confirmado y lectura nueva. Conservar `report.after` antes de evaluar postcondiciones; errores sólo etapa/código/línea sin secretos. Columnas por tabla+nombre, fragmentos por PK compuesta; convertir `name[]` a `text[]` para Node pg. Contrastar catálogo real Preview y regresiones negativas; no confiar en fixtures que acepten cualquier constraint.
- CI verde y health200 no prueban proveedores, restauración productiva, custodia ni lanzamiento global. Conservar resultados fallidos/cancelados como tales. Reusar evidencia sólo con equivalencia demostrada y cumplir controles de integración requeridos del candidato final.
