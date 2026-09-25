# Folio — tablero único de lanzamiento

Actualizado el 25/09/2026. A dirige, revisa y publica. [AVANCES.md](AVANCES.md) es la vista breve para el titular, disponible como archivo; su apertura en el panel lateral quedó encolada; cada fila cambia sólo ante un resultado significativo. La vista web4420 quedó apagada tras la interrupción y el reinicio de su proceso fue rechazado por política de ejecución. No impide actualizar el archivo ni continuar implementación.

El [historial íntegro anterior](LAUNCH-BOARD-HISTORY-20260925.md) se conservó sin alterar. Copia exacta fuera de Git: `C:/Users/amiun/Documents/Codex/folio-manager-evidence/launch-board-history-exact-20260925.md`, SHA256 `4E44550C8530E6C5B65E2AA4D8B81D85437DF342AA53F35356FD32BC7001C49C`. Contiene diagnósticos, fallos, autorizaciones, publicaciones y planes sustituidos. Este archivo gobierna el estado vigente; las fechas y estados históricos no vuelven a abrir trabajo ya cerrado.

## Estado de publicación

- **Master y Escritorio:** `c0fdf6312e9e9b60bd19dbc7b7d7cd1129ee56fa`, squash PR183 del 25/09 a 10:58:02 UTC. Árbol `b3c9e86852dec43ee50159110e26825810d8a972`, idéntico al candidato `eff59f9d7fd24cc4806258eeab0d55734169b393`. Escritorio tracked limpio; archivos ajenos conservados.
- **Producción:** Vercel `dpl_5Sp9P6pRN9WHowbyU4hit8VyFpCQ`, READY 11:00:21.480 UTC, Git/master/gru1, raíz y www. HTTP11:04:29: health/login/pantalla200, configuración anónima307 al ingreso y API sin credencial401/no-store. Sin fixture autenticado productivo.
- **Base de datos:** M142/M143 aplicadas una vez antes del merge, COMMIT confirmado y lectura nueva;133→135 versiones canónicas. Datos, políticas y controles anteriores conservados. Evidencia `folio-b04-evidence/b04-m142-m143-apply-2026-09-25T10-57-27.381Z.json`, SHA256 `21D53A3511404D29F1787011330487AC9832685725E74C5A44259E4F22EC4A0D`.
- **CI candidato PR183:** App36125833477 PASS,2385 unidades/0 fallos, recuperación100 PASS+15 SKIP/0 FAIL y build PASS. SQL36125833441 PASS con tres carreras PostgreSQL reales; Access36125833447 PASS. Preview jtvukmwykeaqrxcmvpsk PASS y catálogo real contrastado: seis funciones y135 versiones. B03 SKIPPED por condición, no PASS.
- **CI squash PR183:** SQL36126818352 y App36126818304 PASS; App terminó11:04:27 UTC con2385 unidades, recuperación100+15/0 y build PASS. Informe final `folio-b04-evidence/pr183-publication-final-c0fdf63.json`, SHA256 `84F8F497B07459508416155A2B45C43E33D553226E62C4370192D90EC712D598`.
- **Límite B04a:** protege constancia, revisiones de identidad/fecha y autor histórico; todavía sin interfaz, bloqueo clínico ni aprobación del criterio humano. No activa políticas globales ni proveedores.
- **PR181 cerrada:** llamador publicado, seis vistas375/1440 revisadas, ensayo completo36124468806 PASS y App/SQL del squash PASS. Final `folio-b10-evidence/pr181-publication-final-24ab4a0.json`, SHA256 `41BDA5DB2FC6127E61AA98EEEFAE17158234BD599128D34A78C73BD0E4A3628E`. Llamar conserva EN_SALA; pantalla sin nombres; revocación y respuesta perdida probadas. No repetir por rutina.
- **PR182 cerrada:** descarga profesional de historia y archivos, candidato7237212/squash457a613. Final `folio-b06-evidence/pr182-publication-final-457a613.json`, SHA256 `1E5187BBBD14AD1C59F2DA8ECDD588C61C4A75476FF2B72C4CFFC41B607D4BD7`. Ensayo HTTP50MiB aprobado; portal, selector nativo e inventario máximo pendientes.

## Equipo y siguiente integración

Máximo dos escritores, copias aisladas, implementación Sol High y dirección/revisión A. Base de ambos paquetes: `c0fdf6312e9e9b60bd19dbc7b7d7cd1129ee56fa`. Los agentes anteriores de exportación, llamador y B04a terminaron; sus copias permanecen congeladas.

| Paquete activo | Responsable y propiedad | Entorno, pruebas y cierre |
|---|---|---|
| B09a · ficha aportada por el paciente | patient_intake_foundation · rama codex/launch-patient-intake-foundation. M144 reservada:20260925111500; SQL y helpers/tests/docs propios; único paso focal M144 en pgtap.yml autorizado. | [Contrato](B09-PATIENT-FORM-CONTRACT.md). Invitación/sesión revocable, aporte administrativo cifrado e inmutable y recibo idempotente. Depende de M142. PostgreSQL efímero sintético, sin Docker local ni producción. Negativas de roles/alcance, revocación, ABA, cifrado e idempotencia y carreras reales. Revisión independiente antes de publicar; sin HTTP/UI ni preguntas clínicas todavía. |
| B04-R · revocación durante atestación | adult_revocation_fix · codex/launch-adult-revocation, base c0fdf63. M145 reservada20260925114500; funciones privadas/públicas de atestación, SQLspec propia y extensión de tests/concurrency/M142_adult_attestation.mjs. | Hallazgo estático nuevo: require_staff no retiene sesión/factor Auth mientras espera paciente; alcance por turno histórico también requiere retención. Reproducción PG16 aislada con barreras reales, corrección append-only y revisión independiente. Sin tocar M142/M143 aplicadas, política global ni CI que pertenece a B09. |

- Aviso móvil terminado por mobile_google_notice, revisión A aprobada tras retirar el fondo crema legado. PR184 candidata253e7da758fd324f769237df0e70753bdadb3e2e, árbol5863e8c7bd06830e2a1d6b599b2a6a7efb4762e6; componente real320/375/1440 y oscuro375, foco/contraste aprobados. App36128926128 en curso; SQL36128925935 PASS, Preview/B03 SKIPPED. Evidencia antes/después en folio-b10-evidence/mobile-google-notice-c0fdf63 y mobile-google-notice-violet-172ca2f; revisión pr184-review-a-253e7da.md. Sin cambios de proveedor.
- A mantiene tablero, cuota, revisión y publicación. Revisor independiente adicional cuando exista diff concreto; no tercer escritor. Los agentes entregan evidencia breve y no amplían su alcance.
- C05 cuenta con [contrato de ensayo externo](C05-GOOGLE-PROOF-CONTRACT.md), preparado sólo mediante lectura. Falta cuenta/calendario de prueba autorizado; sin escritor ni activación. La ausencia de sync-google en cron es evidencia pendiente, no autorización para programarlo a ciegas.
- Lección PR183: una Preview verde conservaba el cuerpo anterior de una migración ya aplicada. Se restauraron los bytes originales M142, se añadió M143 y se contrastaron los cuerpos reales. Fallo y corrección preservados; nunca sustituir una lectura de catálogo por el color de CI.

## Lista de checkpoints, sin semanas obligatorias

Selección por riesgo, dependencia, utilidad y esfuerzo restante. Terminar, comprobar, entregar y elegir el siguiente trabajo útil. Estados distintos: defecto reproducido, hipótesis, evidencia pendiente, decisión humana, probado y publicado. Una prueba parcial no cierra el checkpoint global.

| Checkpoint | Estado actual | Condición de cierre |
|---|---|---|
| Recuperación completa · C01 | Ensayo integral sintético aprobado e integrado PR167; custodia externa aparte | Recuperar DB, datos cifrados, archivos, contraseña/MFA y aislamiento. Evidencia36073216478; no repetir por rutina ni afirmar restauración de producción. |
| Permisos y privacidad · B05 | PR170/174 publicadas; alcance global aún requiere revisión final | Roles, organizaciones, acceso directo, archivos, consentimiento y revocación respetan el alcance autorizado. |
| Ingreso y onboarding · B01/B02 | PR175/177 publicadas y probadas | Registro, confirmación, recuperación y Solo/Clínica sin reparación manual; salir, volver y completar después. |
| Recepción · B03 | PR172 publicada y ensayo36076854795 PASS sin omisiones | Agenda y llegada para Asistente/Coordinador según alcance; operaciones administrativas no inician atención. |
| Atención adulta · B04 | Base privada PR183 publicada; B04-R investiga revocación simultánea. Interfaz, criterio clínico y activación pendientes | Proteger nuevas atenciones; conservar historias, consultas iniciadas y correcciones autorizadas. Activación separada de instalación. |
| Miniweb profesional · D06 | PR171 publicada y revisada en móvil/escritorio | Plantilla Folio, dos disposiciones, dirección/mapa confirmado, servicios/reserva; página de clínica y enlace individual con permiso propio. Editor sencillo y completar después. |
| Ficha del paciente · B09 | B09a en implementación aislada; M144 reservada | Enlace/QR, datos/motivo y 5–10 preguntas aprobadas por especialidad. Personal autorizado revisa e incorpora sin reescribir ni sobrescribir silenciosamente. |
| Llamador · B10 | PR179/181 publicadas; recorrido completo y revisión visual aprobados | Código/destino sin datos personales, pantalla limitada/revocable, estado de conexión y reconexión silenciosa; llamar no inicia consulta. |
| Google Calendar · C05 | Evidencia externa pendiente | Folio gestiona turnos y los refleja; eventos externos bloquean horarios. Cambios y reintentos no duplican. |
| Correo · C03 | Entrega global desactivada; evidencia pendiente | Buzones controlados, errores visibles, entrega/reintentos sin duplicados, enlace de ficha el día del turno. |
| Pagos/suscripciones · C04 | Evidencia externa pendiente | Solo/Clínica, asientos, pendientes, mora, cancelación y conciliación con respuestas interrumpidas y eventos desordenados. |
| Portal y exportación · B06 | Descarga profesional PR182 publicada y comprobada; portal e inventarios máximos pendientes | Adulto autorizado obtiene sus datos y archivos íntegros. Distinguir inventario, archivo entregado y documento retirado. |
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

Última lectura real, 25/09 a 11:10 UTC:33% usado /67% disponible; reserva15%. Reinicio informado por la herramienta:01/10/2026 21:27:44 UTC, cero créditos. No presumir reinicio el sábado 26/09. No atribuir consumo exacto a cada agente ni convertir cuota en horas garantizadas.

Al llegar a85% usado, no abrir implementación nueva: cerrar paquetes revisables, preservar evidencia y dejar continuación. La calidad y los criterios gobiernan el cierre; no consumir cuota artificialmente ni repetir pruebas verdes sin cambio, fallo o duda concreta. El titular autorizó continuar autónomamente mientras duerme; pedir sólo decisiones indispensables y seguir con trabajo independiente.

Heartbeat `folio-manager-por-checkpoints`: respaldo horario silencioso ante interrupciones, no ritmo de trabajo. No terminar el turno para esperar su próxima activación mientras haya trabajo útil autorizado. Verificar cuota/cupo/agentes antes de reanudar; no duplicar escritores. No modificar el recordatorio de copia semanal. Este tablero, las copias y la evidencia permiten relevo de manager si hace falta.

Entrega al titular: qué mejoró, evidencia breve, dónde probarlo y qué falta. Al detenerse, cuatro o cinco párrafos sencillos con la razón real y pasos concretos en la aplicación. El archivo AVANCES.md es el registro disponible; el panel web4420 sigue apagado por el rechazo de ejecución documentado arriba.

## Disciplina operativa y checkpoint que no se repite

- PR165 cerrada: master `c5c5fed53f5b72dbebb604c1812b25c54a5d23b7`, candidato `58f534bb9bb735965b2b6c177fd849c3eec5d775`, árboles iguales. Ensayo `hosted-smoke-evidence/2026-09-19T17-53-48.159Z-d7d715794d6c45b6.json` aprobado; fallo final-off anterior preservado. No repetir su recorrido ni reactivar M106/M120/M121 ni cambiar sus motivos históricos. No se ejecutó RED del componente anterior.
- Master autodespliega; Supabase Git aplica pendientes. Migración aditiva antes del código; cierre/enforcement en publicación separada cuando exige código nuevo. PR170 demostró que juntar expansión y cierre puede anticipar el cierre: no repetir esa secuencia. M129 conserva sus cinco sentencias canónicas.
- Producción135 versiones a M143, incluidas M125/M126/M127/M128/M129/M130/M132/M133/M134/M135/M136/M137/M138. Los borradores no aplicados siguen conservados en el historial; los IDs no reemplazan las versiones canónicas. Releer ledger antes de cualquier nueva instalación.
- No iniciar/resetear/prunear Docker local ni borrar bases, volúmenes, worktrees, fixtures, respaldos, informes o archivos ajenos. Usar entornos efímeros autorizados y datos sintéticos para pruebas. No repetir una escritura cuyo resultado es incierto: primero lectura nueva.
- No envíos, compras, cargos reales, activación Google ni cambios ciegos en MFA/consentimiento/adjuntos/población/disponibilidad. La entrega global de correo sigue apagada. Preparar las acciones sensibles externas para autorización concreta; no inferirlas de un ensayo local.
- Mantener el par Upstash reparado; el sobre original contiene el par viejo y no debe restaurarse encima. DPAPI depende del perfil Windows y no acredita custodia portable externa. Nunca imprimir secretos. Preservar `.env.local` antes de herramientas que puedan escribir configuración.
- Operadores: bytes SQL/HEAD/árbol fijados, preflight de sólo lectura, comparación dentro de transacción, COMMIT confirmado y lectura nueva. Conservar `report.after` antes de evaluar postcondiciones; errores sólo etapa/código/línea sin secretos. Columnas por tabla+nombre, fragmentos por PK compuesta; convertir `name[]` a `text[]` para Node pg. Contrastar catálogo real Preview y regresiones negativas; no confiar en fixtures que acepten cualquier constraint.
- CI verde y health200 no prueban proveedores, restauración productiva, custodia ni lanzamiento global. Conservar resultados fallidos/cancelados como tales. Reusar evidencia sólo con equivalencia demostrada y cumplir controles de integración requeridos del candidato final.
