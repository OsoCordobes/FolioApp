# Folio — tablero único de lanzamiento

Actualizado: 20 de septiembre de 2026. Responsable: A, manager.
Este tablero gobierna el trabajo nuevo. Los informes anteriores se conservan como evidencia fechada; sus bloqueos superados no se convierten nuevamente en tareas.

## Objetivo y alcance acordados

Lanzar Solo y Clínica, las cinco especialidades actuales, Google Calendar y portal para atención de adultos. Prioridades: acceso/registro/onboarding, recuperación demostrada, recorridos completos y una página pública profesional de calidad para compartir en redes.

- Especialidades: quiropraxia, cardiología, psicología, kinesiología y nutrición. El titular coordina los tres profesionales piloto y la revisión competente de las otras dos especialidades.
- Menores: etapa posterior. La atención nueva requiere edad verificada de al menos 18 años; fecha desconocida no equivale a adulto. Preservar historias, exportaciones, recibos y correcciones históricas autorizadas.
- Reserva pública: comunicar el alcance adulto y pedir declaración explícita; verificar fecha de nacimiento antes de atención. No afirmar que la declaración impide por sí sola toda solicitud de un menor ni sobrescribir identidad existente desde un formulario público.
- Agentes automáticos: preparar procedimientos y permisos para una etapa posterior; no construir una plataforma de agentes durante este cierre.
- WhatsApp automático, receta electrónica y emisión fiscal integrada no se añaden al alcance público actual. Conservar controles sobre código preparatorio y evitar activación accidental de canales.
- Mantener arquitectura, diseño Folio, precios existentes y proveedores; no compras ni recortes de oferta sin decisión del titular.

## Checkpoint cerrado de PR165

Fuente: cierre aportado por el titular el 19/09. Lectura actual del manager: HEAD local y referencia remota master coinciden con `c5c5fed53f5b72dbebb604c1812b25c54a5d23b7`; no hay cambios tracked en el Escritorio. No se repitió la campaña productiva.

| Elemento | Estado y evidencia |
|---|---|
| PR165 | Squash integrado el 19/09 a las 17:55:05 UTC; <https://github.com/OsoCordobes/FolioApp/pull/165> |
| Master | `c5c5fed53f5b72dbebb604c1812b25c54a5d23b7` |
| Candidato probado | `58f534bb9bb735965b2b6c177fd849c3eec5d775`; árbol idéntico al squash, comprobado durante planificación |
| Producción | `dpl_7VZKxVgpaLWVGvvFNLFG2fzP4Nsm`, READY, gru1, SHA de master; dominios y seis crones comprobados en el cierre |
| CI | Aplicación, SQL y Supabase Preview aprobados. Último control master 18:00:24 UTC: 2231/2231 unidades, recuperación 68 PASS + 14 SKIP / 0 FAIL, build PASS. Referencias: `ci-all-c5c5fed.json`, `ci-app-c5c5fed-summary.log` |
| Ensayo hospedado final | Final-on aprobado 17:53:48 UTC. Referencia privada: `hosted-smoke-evidence/2026-09-19T17-53-48.159Z-d7d715794d6c45b6.json`. No repetir por rutina |
| Base | 117 migraciones canónicas; expansión 21 y cierre 4 confirmados. No reaplicar |
| Activaciones | M106 desde 17:33:53 UTC; M120 y M121 desde 17:51:51 UTC. No reactivar ni modificar motivos históricos. Referencia: `activation-final58-readback-20260919.json` |
| Configuración | Par Upstash reparado; otras 93 entradas preservadas. Vercel Pro activo; entrega global de correo apagada; sin cargos reales ni rotación clínica |

El ensayo de efectivo ficticio no prueba Mercado Pago, entrega de mensajes, restauración integral ni custodia externa. MFA, consentimiento, adjuntos, población y disponibilidad conservan controles separados. Calendario de recepción no quedó acreditado por el arreglo de Hoy.

El par Upstash nuevo prevalece sobre el del sobre antiguo. Su referencia privada es `C:/Users/amiun/folio-recovery/upstash-pair-repair-20260919T171749782Z-5f582d02dafa/new-pair.dpapi`. No copiar secretos a este tablero ni restaurar el par antiguo sobre el reparado. DPAPI depende de la identidad/perfil Windows.

## Autoridad, coordinación y entornos

- A mantiene este tablero, reserva cambios compartidos y decide el orden de integración. Cada trabajador entrega un reporte breve con SHA y referencias sanitizadas; no crea otro backlog general.
- Copia canónica de coordinación: `C:/Users/amiun/.codex/worktrees/folio-launch-manager/folio-app/docs/LAUNCH-BOARD.md`, rama `codex/launch-manager`.
- El Escritorio, sus archivos no seguidos, otros proyectos, respaldos, fixtures y worktrees anteriores se preservan. Cada tarea usa su worktree; no escribe en el de otra.
- Dos permisos de escritura de implementación: **B (B02a) y A (integración) actualmente**. D cerró D01 y revisa B02a; C recibió una ventana operativa local acotada, sin cambios de código. La edición administrativa del tablero pertenece a A.
- B y C no editan migraciones sin reserva explícita del manager. No hay migración nueva reservada en esta primera ola.
- Reserva adicional B01: `scripts/testing/app-config.mjs`, `app-bootstrap.mjs`, `isolation-policy.mjs` y tipos/pruebas asociados, sólo para sitekey oficial de prueba constante bajo opt-in estricto. Mantener red externa y credenciales heredadas bloqueadas. C no edita esa frontera; coordinar necesidades de `recovery-bootstrap.mjs`.
- Reserva D01: componentes y estilos `.bl` de la página pública, página/OG `/book/[slug]`, contenido, fixtures y pruebas focales. Incluye `app/(app)/configuracion/perfil-publico-actions.ts` para invalidar página/OG al editar o retirar datos públicos, sin ampliar su exposición. B no edita esos archivos.
- Ningún trabajador hace merge, despliegue, mutación productiva, envío real, cargo, rotación de claves ni eliminación de evidencia. Preparar paquete concreto para autorización del titular cuando corresponda.
- Revisiones: D revisa B/C; B revisa D; A integra después de revisión y checks. Un autor no aprueba su propio cambio.
- Puertos de aplicación reservados: B 4430, C 4432, D 4434. Usar runners aislados del repositorio y comprobar ocupación antes de iniciar. Un puerto ocupado no autoriza matar procesos ajenos.
- Runtime clínico previo `C:/Users/amiun/Documents/Codex/folio-clinical-runtime`: evidencia preservada, no reutilizar su base para escrituras ni resetearla. C prepara destino nuevo y dedicado para restauración; B/D usan respuestas controladas mientras no reciban un entorno asignado.
- Destino sintético C01 reservado: `C:/Users/amiun/Documents/Codex/folio-c01-recovery-synthetic`, project_id `folio-c01-recovery`; API 55421, DB 55422, Studio 55423, Inbucket 55424, app 4432. C debe verificar todos los puertos adicionales y volúmenes antes del arranque. La reserva no acredita que el runtime esté funcionando.
- No copiar `.env.local` productivo a worktrees. Antes de CLIs que puedan escribir configuración, preservar copia protegida fuera del repo. Nunca imprimir secretos ni activar proveedores en pruebas automatizadas.
- Leer `C:/Users/amiun/.codex/RTK.md`; usar salida acotada y conservar logs completos. `AGENTS.md` no está versionado: leer también el del Escritorio y `CLAUDE.md` de cada checkout.

## Equipo y cuota

| Sesión | Modelo/esfuerzo solicitado | Primera asignación | Permiso inicial |
|---|---|---|---|
| A — Manager | GPT-6 Astra / High (selección del titular; no autoconfirmar cambio de modelo) | Tablero, coordinación y revisión de bloqueos | Documentación de coordinación |
| B — Acceso y producto | GPT-5.6 Sol / High | B01 | Escritura en ámbito asignado |
| C — Continuidad y proveedores | GPT-5.6 Sol / High | C01 | Escritura en ámbito asignado |
| D — Experiencia y verificación | GPT-5.6 Sol / High | D00, después revisión B01 | Sólo lectura/verificación al inicio |

Tareas creadas mediante Codex con `gpt-5.6-sol` y `thinking: high`:

| Sesión | Task ID | Worktree |
|---|---|---|
| B | `01a0bb34-d7b9-7841-b45c-1889b0b987dd` | `C:/Users/amiun/.codex/worktrees/3edf/folio-app` |
| C | `01a0bb34-d802-7852-82c5-126c0af7e654` | `C:/Users/amiun/.codex/worktrees/ede1/folio-app` |
| D | `01a0bb34-d7b9-7841-b45c-189d01589d14` | `C:/Users/amiun/.codex/worktrees/f12d/folio-app` |

Cuota observada al iniciar ejecución: **67% restante**, reinicio **26/09/2026 14:59:03 UTC**. Es compartida con otras tareas; cambios de saldo no se atribuyen automáticamente a un trabajador. Presupuesto: saldo actual + dos ciclos. Reservar aproximadamente 15 puntos por ciclo para integración/incidentes. Velocidad estándar; no convertir porcentajes a horas/tokens prometidos.

Medir antes/después de cada paquete. Tras tres intentos sin nueva evidencia, detener ese enfoque, describir el bloqueo y cambiar de estrategia. No lanzar auditorías amplias ni subagentes sin una subtarea acotada, ahorro probable y cupo disponible.

### Política de cierre semanal solicitada por el titular

Continuar trabajo útil mientras haya margen y entregar un checkpoint con mejoras visibles para probar hasta el siguiente reinicio. No consumir cuota para alcanzar un umbral artificialmente.

- Con **20% restante**, no abrir paquetes nuevos: cerrar los ya avanzados, revisar, integrar y preparar la entrega.
- Con **10% restante**, conservar la reserva para fallos de integración, informe, recuperación y respuestas al titular; no iniciar investigación extensa.
- Primera mejora visible priorizada: registro/onboarding recuperable. Segunda: página pública profesional, si supera revisión y pruebas.
- Liberar el cupo de un frente bloqueado por una dependencia externa después de dejar preparación/evidencia suficiente, para avanzar el siguiente entregable visible.
- Cada checkpoint debe incluir SHA, estado local/preview/producción explícito, cambios comprobados, limitaciones y un recorrido corto de prueba para el titular. No llamar desplegado a una tarea lanzada ni declarar resuelto el CAPTCHA externo sin comprobación real.

## Estado de tareas

Estados: `pendiente`, `asignado`, `en curso`, `en revisión`, `aprobado local`, `pendiente de autorización`, `comprobado en destino`, `bloqueado por dependencia`. Naturaleza: `defecto observado`, `defecto reproducido`, `evidencia pendiente`, `decisión humana`, `mejora acordada`.

| ID | Prioridad / naturaleza | Responsable / revisor | Estado | Aceptación y dependencia |
|---|---|---|---|---|
| A00 | Alta / coordinación | A | aprobado local | Tablero y referencias históricas en commit `50e87b7`; B/C/D creados con Sol/High y worktrees propios; master local/remoto conserva el checkpoint |
| B01 | Bloqueante / defecto de configuración comprobado + mejora de recuperación | B / D | aprobado local `82591bf`, integrado como `feb8d60`; corrección Cloudflare autorizada, no confirmada | Typecheck/lint/build PASS; unidades 2234/2234; navegador 5/5 + registro alternativo 1/1; D aprueba SHA exacto. Widget publicado coincide con Cloudflare, cuyo único hostname permitido era el antiguo de Vercel. Falta readback de agregar foliosalud.com, CI integrado y prueba humana |
| B02 | Alta / defecto de contrato + evidencia pendiente | B / D | B02a asignado; resto pendiente de runtime | Recuperar contraseña ignora rechazo por límite y muestra enviado; B corrige UI y prueba respuesta incierta/doble envío en aislamiento. Registro/confirmación/onboarding real/MFA siguen pendientes; pruebas antiguas omiten confirmación por email |
| C01 | Bloqueante / evidencia pendiente | C / D | preparador `6f2dc4e` aprobado e integrado; ensayo bloqueado | D aprueba TOML local fijo y creación exclusiva; 3 pruebas PASS, parse TOML y lint focal PASS. Integrado como `4b8cc7b` + `bcdfa52`. Preservar destino anterior sin ejecutar. Docker sin motor disponible; restauración completa/Auth/Storage/login/descifrado todavía no acreditados |
| C02 | Alta / decisión humana + evidencia pendiente | C / A | pendiente | Copia externa y material portable probado fuera del perfil Windows; par Upstash actualizado; custodio y destino autorizados |
| B03 | Alta / brecha de implementación identificada | B / D | pendiente | Calendario semana/mes para ASISTENTE y COORDINADOR, sin ampliar acceso clínico/financiero; pruebas directas y de interfaz |
| B04 | Alta / mejora acordada + evidencia pendiente | B / D | pendiente | Política de nuevas atenciones adultas efectiva en servidor/base, DOB desconocida bloquea atención; límites de 18 años y concurrencia; históricos/borradores/recibos preservados |
| B05 | Alta / evidencia pendiente | B / D | pendiente | MFA y recuperación de cuenta, controles separados de adjuntos/disponibilidad/consentimiento; roles, revocación y dos organizaciones; activar sólo con paquete revisado |
| B06 | Alta / evidencia pendiente | B / D | pendiente | Portal adulto, CSV, archivos y exportación completa autorizada; reutilizar pruebas ya aprobadas y cubrir sólo huecos/diffs |
| C03 | Alta / evidencia pendiente | C / D | pendiente | Auth/SMTP y correo Folio entregados a buzones controlados; cola retenida revisada; fallos/cuotas visibles; no activar WhatsApp incidentalmente |
| C04 | Alta / evidencia pendiente | C / D | pendiente | Mercado Pago Solo/Clínica/asientos/cancelación/mora/conciliación; duplicados, desorden y respuesta perdida; distinguir sandbox de cargo real |
| C05 | Alta / brecha de programación + evidencia pendiente | C / D | pendiente | Google conecta, sincroniza entrada/salida, bloquea horarios y se recupera de revocación/webhook ausente; programar sync periódico después del ensayo autorizado |
| D00 | Alta / mejora acordada | D / A | aprobado local, revisión de código | Propuesta concreta de identidad/foto/bio/OG, Solo/Clínica y matriz de pruebas recibida; sin render ni prueba visual todavía. D disponible para revisar B01 |
| D01 | Alta / mejora acordada | D / B | aprobado local `87f444e`, integrado como `10e7d74` | B aprueba SHA exacto; tipos/lint/build PASS, 2235/2235 unidades y 11/11 navegador, OG real PNG/JPEG/WebP/corrupto, 360/390/1280/zoom y contraste >=4,5:1 medido. A aprueba composición móvil. CI del candidato integrado y despliegue pendientes |
| C06 | Alta / evidencia pendiente | C / D | pendiente | Alerta externa de caída/copia vencida comprobada; responsable/suplente, cuotas y soporte; capacidad medida para hasta 10 profesionales inicialmente |
| H01 | Alta / decisión humana | Titular y profesionales / A | pendiente | Tres profesionales piloto; revisión adicional de kinesio/nutrición; identidad/habilitación, instrumentos adultos, responsabilidades, privacidad/contratos/facturación revisados |
| L01 | Bloqueante / evidencia pendiente | A + profesionales / D | pendiente | Puertas previas aprobadas, piloto 14 días y al menos 5 jornadas por cada uno de los 3 profesionales; cero bloqueos críticos/altos del alcance ofrecido |
| L02 | Alta / publicación | A / revisor independiente | pendiente | Commit/CI/migraciones/deployment/dominos/control activo coherentes, retorno compatible, oferta alineada; autorización concreta donde corresponda |

## Contratos de la primera ola

### B01 — acceso desde Probar Folio

Base: `c5c5fed53f5b72dbebb604c1812b25c54a5d23b7`. Ámbito de escritura: componentes de auth/onboarding, `lib/security/turnstile.ts`, sus acciones y pruebas asociadas. Archivos de configuración global/CSP: proponer diff al manager antes de editar. No tocar backups, booking público, CSS global ni esquema sin coordinación.

Reporte del titular: la psicóloga entra a la landing, toca **Probar Folio** y ve el error al registrarse; cree que usó PC. Captura local privada: `C:/Users/amiun/AppData/Local/Temp/codex-clipboard-31bc102b-fb9b-4d57-a873-606638d60e0d.png`. Mensaje: “No es posible conectarse al sitio web”. Navegador/URL exacta aún no conocidos; no bloquear investigación local por esto.

Hechos previos de inspección: callbacks descartan el código de error; polling sin plazo; CSP fuente ya permite scripts/frames de Cloudflare. Hay una hipótesis de remonte del widget en login progresivo, no causa demostrada del primer registro. Separar error de script/render/challenge de error Siteverify. No ampliar CSP, rotar claves ni desactivar protección por suposición.

Entorno: pruebas aisladas con claves oficiales de test y env sintético. Lectura pública de landing/registro permitida; sin crear cuentas, enviar formularios reales ni resolver CAPTCHA automáticamente. Configuración privada: sólo inventario necesario, sin valores secretos ni mutaciones.

Pruebas: error de carga, error/expiración, token consumido, alternar login/registro, reintento y remonte, doble submit, red fallida; preservar datos y ofrecer recuperación. Automatización no acredita el desafío real. Cierre local: reproducción/hipótesis diferenciadas, regresión significativa, tipos/lint/unidades/build requeridos, SHA y reporte a D. Cierre final: prueba humana representativa tras autorización de publicación.

### C01 — restauración completa aislada

Misma base. Ámbito: `scripts/backup/`, `scripts/recovery/`, `tests/recovery/` y reporte propio. Documentación de respaldos: proponer cambios al manager; tablero sólo A. No modificar secretos productivos ni configuración externa.

Primero inventariar sin descifrar/imprimir secretos los recibos, runtime sellado y destinos; distinguir hechos del checkpoint de evidencia accesible. Reutilizar programación Windows existente; no reconstruirla por cabeceras antiguas. Restaurar primero un paquete sintético completo en Supabase 17 real dedicado, con proveedores/crones salientes apagados. Preparar el ensayo de la copia real bajo alcance/destino explícito y privado; no introducir PHI en herramientas, logs ni reportes.

No usar ni resetear bases/volúmenes existentes para ganar espacio. Los scripts de Storage exigen loopback: no retirar la protección para conseguir un resultado. Si se necesita destino alojado/custodia física, preparar paquete revisable y señalar la intervención exacta. No tocar `lorenzo-quiropraxia`.

Aceptación: Auth/MFA/Storage reales, bytes/hashes y permisos, descifrado clínico sintético, aplicación operativa, configuración inventariada y duración. Ensayo sintético, copia real, custodia independiente y regreso alojado son hitos separados; no etiquetar uno como todos. Ejecutar recuperación focal y checks apropiados; conservar fallos y omisiones con explicación.

### D00 — revisión y propuesta visual sin escritura

Misma base. Leer `emil-design-eng` y sólo las superficies pertinentes: página pública `/book/[slug]`, contenido y configuración del perfil, vista previa social, estilos existentes y pruebas. No escribir archivos, instalar dependencias, iniciar servidores ni tocar cuentas/entornos hasta coordinación. Entregar en esta tarea una propuesta breve con tabla antes/después y matriz de pruebas; el manager persiste la evidencia.

Dirección elegida: diseño editorial cálido, identidad del profesional protagonista, foto destacada, logo secundario para Solo, servicios legibles, CTA móvil y OG coherente. Usar datos existentes y fallbacks cuidados; sin testimonios/claims inventados, nuevo constructor, Tailwind/shadcn ni dependencias de animación. Preservar consentimiento de publicación y privacidad. Revisar móvil 360/390 px y escritorio, nombres largos, sin foto/bio, varios profesionales/servicios, contraste, teclado y zoom. B revisará la futura implementación D01.

En paralelo preparar aceptación independiente de B01 usando claves de prueba, no CAPTCHA productivo automatizado. No expandir a una auditoría completa del repo.

## Calendario, verificación y publicación

- Saldo actual hasta 26/09: B01 + C01 primero; preparar puertas del piloto y proveedores. Objetivo de inicio de piloto alrededor del 23–25/09 sólo si aprueban sus puertas.
- Ciclo adicional 1, 26/09–03/10: cerrar proveedores, recepción, portal adulto y D01; resolver problemas del piloto.
- Ciclo adicional 2, 03/10–10/10: cierre del piloto, capacidad, revisión y apertura. Objetivo orientativo 09/10, sin prometer fecha si hay dependencias externas.
- Pruebas focales por cambio; `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm build` y CI del SHA exacto por candidato. SQL replay/negativas si cambian contratos de base. No repetir checks verdes sin cambios relevantes ni el smoke productivo cerrado.
- Serializar suites pesadas y uso de Docker. Conservar exit codes/logs, comandos reproducibles y SKIP explícitos. No debilitar aserciones ni actualizar snapshots sin revisión visual.
- Sólo incorporar cambios con revisor distinto. Migración aditiva antes del código dependiente y enforcement después; autorización y readback por control; nunca reusar el retorno anterior incompatible con M106/M120/M121.
- Preparar soporte y alertas que funcionen sin Codex; la coordinación de tareas no equivale a servicio 24/7.

## Registro de decisiones y entregas

| Fecha | Decisión / evidencia |
|---|---|
| 19/09, planificación | Titular elige saldo actual + dos ciclos; inicialmente oferta completa, luego confirma todo salvo menores; agentes para después |
| 19/09, planificación | Tres profesionales disponibles esta semana; titular acepta conseguir revisión de las cinco especialidades |
| 19/09, planificación | Acceso de psicóloga y mejora importante del perfil público pasan a prioridad explícita |
| 19/09, inicio ejecución | HEAD local y remoto coinciden con checkpoint; escritorio sin cambios tracked; cuota 67% |
| 19/09, aclaración | Falla en landing → Probar Folio → registro, probablemente PC; no se conoce aún navegador exacto |
| 19/09, primer hito B | B confirma checkout limpio en base autorizada, rama `codex/launch-access` y CTA hacia `/onboarding`; investiga causa sin formularios productivos ni cambios de CSP |
| 19/09, primer hito C | C confirma checkout/rama `codex/launch-recovery`, pipeline y programación existentes. `docker version` no respondió en 20 s; interrumpió sólo su comando. Destino sintético nuevo reservado; no se abrió ninguna copia real ni se alteró el servicio |
| 19/09, D00 | D entregó revisión de código y matriz de aceptación de página pública/B01. Sin escrituras, instalación ni render; no acredita aprobación visual. Revisó commit documental `50e87b7` sin contradicciones materiales |
| 19/09, B01 diagnóstico | Captura corresponde a Step1Registro de `/onboarding`; lectura pública devuelve 200 y CSP permite scripts/frames Cloudflare. Manejo de error/polling incompleto identificado. Causa original del fallo externo aún no probada; UI recuperable no equivale a bloqueo resuelto |
| 19/09, seguimiento cuota | 64% restante, frente a 67% al iniciar. Pool compartido; no atribuir todo el consumo a esta ola. Reserva de integración se mantiene |
| 19/09, nueva prioridad semanal | Titular pide continuar hasta cerca del límite y cerrar mejoras visibles testeables entre ciclos. Manager fija cierre de nuevos frentes al 20% y reserva operativa del 10% |
| 19/09, preparación C01 | Commit `3fd54f7a3922fa9c66a824568632f0faf049624b`: preparador de destino nuevo y pruebas 2 PASS. Configuración dedicada creada sin iniciar Docker/volúmenes ni abrir copia real. Lint pendiente por instalación local inconclusa; suite pesada reservada a B. Incompatibilidad con destino Supabase no vacío deducida, todavía no reproducida |
| 19/09, relevo C a D | C libera escritura y continúa análisis acotado. D revisa B01/C01 y comienza implementación D01 en copia propia; sólo B y D escriben implementación |
| 19/09, configuración Cloudflare | Lectura Vercel sin descifrar: entradas `TURNSTILE_SECRET_KEY` en preview/production y `NEXT_PUBLIC_TURNSTILE_SITE_KEY` en development/preview/production presentes. No prueba correspondencia entre claves ni dominios autorizados. Dashboard Cloudflare requiere inicio de sesión del titular; consulta pendiente |
| 19/09, revisión B01 | D detectó excepción/doble envío sin recuperación en registro alternativo y falta de prueba de ciclo de vida. B corrige y añade navegador aislado; pruebas de helpers por sí solas no acreditan el flujo. Hallazgo especulativo sobre dos widgets simultáneos retirado por D al comprobar vistas excluyentes |
| 19/09, revisión C01 | D solicita TOML mínimo permitido en vez de copiar configuración con blacklist incompleta, y creación exclusiva del directorio para cerrar carrera. C acepta; corrección pendiente de cupo. Destino ya creado se preserva sin ejecutar. Servicio Docker detenido no basta para explicar fallo: Desktop/backend vivos pero WSL docker-desktop detenido |
| 19/09, estrategia C01 | C propone primero instancia Supabase PG17 propia y exclusiva, restaurar archivo lógico íntegro en una segunda base vacía con guard actual, y conectar después Auth/Storage/PostgREST. Requiere prototipo; no está aprobado ni demostrado. Importar selectivamente sobre schemas administradas queda como alternativa más compleja. Nunca confundir archivo lógico con respaldo físico `--from-backup` |
| 19/09, D01 dependencia | Se reserva acción de edición del perfil para invalidación de página/OG tras retirar contenido. D debe comprobar comportamiento de Next15 y preservar privacidad; cachés de redes externas no están bajo control de Folio |
| 19/09, B01 navegador | Cinco escenarios aislados PASS: script bloqueado/reintento conservando campos, error/expiración, remonte login/registro, fallo de render y doble envío. Gates generales en curso. No acredita Cloudflare real ni creación real de cuentas |
| 19/09, Cloudflare indicio adicional | En Chrome del titular, `dash.cloudflare.com/login` también muestra un fallo de verificación sin ingresar credenciales; podría ser entorno/red/automatización. No demuestra la causa original de la psicóloga. La página oficial de estado no muestra incidente activo de Turnstile en esta consulta; sólo incidente WARP geográfico, sin vínculo probado con Folio |
| 19/09, Docker causa actual | C localiza error1920/reparse point en `AppData/Local/Docker/run/dockerInference`, con aborto del backend. Preparó apagado/arranque normales y movimiento reversible del directorio `run` a un hermano fechado, preservando volúmenes/VHDX/Ubuntu. Ejecución pendiente de ventana posterior a pruebas B; nunca forzar ni resetear |
| 19/09, cuota intermedia | 61% restante; continúa trabajo por paquetes y reserva 20%/10%. Cuota compartida con otras tareas |
| 19/09, entrega B01 | `82591bf777b77d2a746b0af5f18ca245a984f360`, árbol limpio. Seis escenarios de navegador comprobados en 5+1, paso CI nuevo y entorno sintético estricto. Logs privados completos en `C:/Users/amiun/AppData/Local/Temp/folio-b01-evidence-3edf/`; D revisa SHA exacto, B revisa D01. Cuota observada 59% |
| 19/09, reparación Docker detenida | `docker desktop stop --timeout 30` falló; POST `/app/quit` venció y Desktop/backend siguieron vivos. C interrumpió sólo su CLI, conservó `run` y no creó `run.hold-*`, no movió datos ni reinició. D recibe slot pesado; C corrige preparador. Cualquier recuperación posterior requiere preflight actual y decisión nueva, sin convertir timeout en permiso de bypass de política |
| 19/09, Cloudflare causa comprobada | Dashboard: widget folio-app, Managed, sin pre-clearance, único hostname folio-app-ten.vercel.app. El asset público desplegado usa exactamente su sitekey pública; foliosalud.com falta. El titular autoriza agregar sólo ese dominio conservando lo demás. Un primer envío de formulario confirmó actualización pero mantuvo un hostname: no acredita la corrección. Se reabrió edición; la conexión se perdió antes de terminar. Sin claves reveladas ni rotadas |
| 19/09, B01 integrado local | D aprueba `82591bf` sin bloqueantes; A incorpora como `feb8d60`. No push ni despliegue al registrar este hito |
| 20/09, recuperación de sesiones | B/C terminaron sus paquetes; D fue interrumpido. A verifica commits y cambios locales conservados y reactiva D y revisión B. Chrome no disponible en el conector; se solicita reconexión, sin repetir autorización. Master remoto sigue c5c5fed y no hay PR abiertas. Saldo semanal 52%, compartido |
| 20/09, aislamiento de candidato | Se desactiva únicamente el despliegue Git automático de codex/launch-manager en vercel.json mientras no esté verificada la separación del entorno Preview. Master, otras ramas, gru1 y los seis crones conservan configuración. GitHub CI y revisión continúan; publicación requiere paquete concreto |
| 20/09, revisión/integración C | D aprueba `6f2dc4e` sólo para preparación, sin arranque ni restore; A integra ambos commits de C sin conflicto. Preflight después del corte confirma mismos procesos colgados, Docker WSL detenido y Ubuntu activo; no cambio de causa. Reparación oficial acotada pendiente de ventana |
| 20/09, revisión de configuración A | B aprueba `9d6ce57`: única rama automática desactivada codex/launch-manager; comprobación JSON confirma crones/región/otros valores idénticos. No acredita que Preview esté aislado |
| 20/09, B02a | B identifica por lectura que Forgot ignora `rate_limited` y no captura excepción. A reserva login-form.tsx y prueba E2E focal propia sobre base B01 para corregir resultado falso, incertidumbre y doble envío, sin cambiar anti-enumeración ni política de servidor. A pausa integración de código mientras escriben B/D; gates pesados esperan liberación de D |
| 20/09, entrega D01 | `87f444e0f0b2045040e2aeb8d5e4a294d548a2ad`, árbol limpio. B aprueba sin bloqueantes; A integra `10e7d74`. Logs y capturas privadas en `C:/Users/amiun/AppData/Local/Temp/folio-d01-evidence-f12d/`. No se probaron servicios reales ni cachés de redes externas. Se conserva saldo observado 52% |
| 20/09, reparación Docker avance parcial | A autoriza una parada oficial forzada después del fallo normal y preflight con motor WSL detenido. C obtiene exit0, verifica cierre y preserva `run` como `run.hold-20260919T232618999Z`. El arranque crea run nuevo pero falla ahora en otro socket: `AppData/Local/docker-secrets-engine/engine.sock`. Directorio todavía sin tocar; no hay recuperación operativa ni ensayo C01. A verifica que sólo contiene ese socket de cero bytes, sin leer secretos |

## Próxima decisión del manager

Completar la corrección Cloudflare ya autorizada cuando vuelva Chrome; integrar D01 después de SHA/revisión y checks finales. Preparar una PR de acceso + perfil y un checkpoint visible con CI exacto y autorización concreta de publicación. Recuperación C01 conserva su bloqueo y revisión pendiente; no sustituirla por pruebas parciales ni repetir el smoke clínico cerrado.
