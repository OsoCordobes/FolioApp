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
- Dos permisos de escritura de implementación actuales: **B (B02b) y D (D02)**. A mantiene documentación y espera relevo antes de integrar código; C permanece en lectura/preparación. La edición administrativa del tablero pertenece a A.
- B y C no editan migraciones sin reserva explícita del manager. **M124 reservada exclusivamente a D para B03**, paquete separado de PR166: lectura de rango para Calendario de recepción, sin cambiar migraciones anteriores ni aplicar en producción.
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
| B01 | Bloqueante / defecto de configuración comprobado + mejora de recuperación | B / D | Cloudflare corregido y titular confirma que desapareció el error; UI aprobada local `82591bf`, integrada como `feb8d60` | Typecheck/lint/build PASS; unidades 2234/2234; navegador 5/5 + registro alternativo 1/1; D aprueba SHA exacto. Widget permite foliosalud.com y dominio anterior, conserva Managed/sin pre-clearance/sitekey. Bloqueo de widget resuelto en prueba humana; CI/publicación UI y recorrido completo de cuenta/onboarding siguen pendientes |
| B02 | Alta / defecto corregido local + evidencia pendiente | B / D | B02a `0bd5ca7` aprobado por D e integrado como `ddcf2dc`; resto pendiente | Recuperar contraseña respeta límite, respuesta incierta y doble envío. Tipos/lint/build PASS, 2236 unidades, 2 focales y 7 navegador combinados; CI final de integración en PR166. Registro/confirmación/onboarding real/MFA y entrega de correo siguen pendientes |
| B02b | Alta / reforma solicitada por titular | B / D + A | en curso desde `f769944`, rama codex/launch-onboarding | Primera elección antes de registro: Profesional independiente o Clínica, sin valor implícito. Dos recorridos pertinentes, precios canónicos por modalidad, responsable tratante/no tratante diferenciado, retomar tras email/OAuth/reload con DB autoritativa. No dar por publicado/listo un perfil o agenda incompletos. Calidad visual y pruebas reales de ambos recorridos antes del cierre |
| C01 | Bloqueante / evidencia pendiente | C / D | preparador aprobado; motor Docker recuperado; ensayo pendiente | Preparador `6f2dc4e` aprobado e integrado. Docker Server29.3.0 y EnableDockerAI efectivo false comprobados; otros ajustes/ACL intactos. C prioriza fallo de locks Linux descubierto por CI antes del nuevo runtime. Restauración completa/Auth/Storage/login/descifrado todavía no acreditados |
| C02 | Alta / decisión humana + evidencia pendiente | C / A | pendiente | Copia externa y material portable probado fuera del perfil Windows; par Upstash actualizado; custodio y destino autorizados |
| B03 | Alta / brecha de implementación identificada | D / B | aprobado local `5288a0b`, separado de PR166 | M124 compone M122, cinco fuentes por alcance, semana/mes y campos mínimos. Tipos/lint/build y2248 unidades PASS;118 migraciones replay y M124 focal PASS. B aprueba SHA exacto; fullSQL posterior/M113 corregido y navegador pendiente. No prod ni push; recursos/errores preservados |
| B04 | Alta / mejora acordada + evidencia pendiente | B / D | pendiente | Política de nuevas atenciones adultas efectiva en servidor/base, DOB desconocida bloquea atención; límites de 18 años y concurrencia; históricos/borradores/recibos preservados |
| B05 | Alta / evidencia pendiente + brecha de política identificada | B / D | pendiente | MFA/adjuntos/disponibilidad/consentimiento, roles/revocación/dos organizaciones. Nueva observación por lectura: M09 permite SELECT org-wide de pedido, también mediante policy FOR ALL; las RPC limitadas de B03 no cierran ese acceso directo. Probar columnas/roles/alcance y preparar corrección aparte antes de declarar cerrados permisos |
| B06 | Alta / evidencia pendiente | B / D | pendiente | Portal adulto, CSV, archivos y exportación completa autorizada; reutilizar pruebas ya aprobadas y cubrir sólo huecos/diffs |
| B07 | Alta / defecto comprobado y corregido local | B / D | M125 `25f0ed5` aprobado, integrado como `fd7038b` | RED exacto previo, GREEN y118/118 migraciones+66/66 specs PASS sin SKIP, incluye M113. Gate MFA M101/guards/atomicidad conservados, AAL1/AAL2 y rollback comprobados. Sólo día Córdoba nuevo; sin modificar datos/flags existentes. CI integrado y autorización de migración productiva pendientes |
| C03 | Alta / evidencia pendiente | C / D | pendiente | Auth/SMTP y correo Folio entregados a buzones controlados; cola retenida revisada; fallos/cuotas visibles; no activar WhatsApp incidentalmente |
| C04 | Alta / evidencia pendiente | C / D | pendiente | Mercado Pago Solo/Clínica/asientos/cancelación/mora/conciliación; duplicados, desorden y respuesta perdida; distinguir sandbox de cargo real |
| C05 | Alta / brecha de programación + evidencia pendiente | C / D | pendiente | Google conecta, sincroniza entrada/salida, bloquea horarios y se recupera de revocación/webhook ausente; programar sync periódico después del ensayo autorizado |
| D00 | Alta / mejora acordada | D / A | aprobado local, revisión de código | Propuesta concreta de identidad/foto/bio/OG, Solo/Clínica y matriz de pruebas recibida; sin render ni prueba visual todavía. D disponible para revisar B01 |
| D01 | Alta / mejora acordada | D / B | aprobado local `87f444e`, integrado como `10e7d74` | B aprueba SHA exacto; tipos/lint/build PASS, 2235/2235 unidades y 11/11 navegador, OG real PNG/JPEG/WebP/corrupto, 360/390/1280/zoom y contraste >=4,5:1 medido. A aprueba composición móvil. CI inicial 054e5ac PASS; CI del candidato final en PR166. Sin despliegue |
| D02 | Alta / nueva dirección visual confirmada | D / B + titular | en curso desde `f769944`, rama codex/launch-public-experience | Página pública con base visual Folio e identidad profesional/clínica protagonista. Reforma coherente con B02b y su vista previa, jerarquía/hero/servicios/contacto/reserva/OG, móvil y escritorio. Conservar privacidad, consentimiento y datos reales; sin testimonios ni verificaciones inventadas. D01 no equivale a aprobación visual final del usuario |
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

### B02b y D02 — nueva experiencia de entrada y página pública

Dirección confirmada por el titular: base visual Folio con identidad del profesional o clínica. B implementa onboarding; D página pública y preview compartida. Base exacta autorizada: `f76994490e5f25797f6f83632fa5fc7ebe74a30c`, conservando sus worktrees aislados y commits anteriores. Sólo B y D escriben implementación. C trabaja en lectura acotada de C05; A coordina documentación e integración. Los paquetes nuevos todavía no están publicados.

- Primera pantalla anterior al signup: dos opciones explícitas, Profesional independiente y Clínica, sin elección por defecto. Mantener la intención al volver de email/OAuth; DB y membresía verificadas son autoritativas después del bootstrap. Un draft o query nunca cambia una organización existente, permisos ni precio contractual.
- Navegación: salida visible «Volver al inicio» en todas las pantallas; raíz pública accesible con y sin sesión, sin rebote por /hoy al wizard incompleto. Revisar Atrás, enlaces de login/registro y retornos email/OAuth; conservar guardados y sesión, mantener gates privados/MFA. Se autoriza ajuste focal de `lib/auth/route-decision.ts` y pruebas; no un rediseño general de rutas.
- Solo configura su identidad profesional, especialidad, consultorio, servicios y agenda. Clínica configura organización y equipo; su responsable indica si también atiende. Al responsable no tratante no se le asigna ficha pública, matrícula, horarios ni Google personal como si fuera un profesional. Invitaciones pendientes no equivalen a profesionales disponibles.
- Conservar los permisos del rol OWNER vigente: `es_colegiado=false` no significa acceso clínico restringido bajo M101. Este paquete no crea un nuevo rol administrativo limitado ni modifica silenciosamente la matriz RLS; esa frontera permanece en B05.
- Bootstrap atómico/idempotente con tipo y condición asistencial explícitos. M126 reservada, sin editar archivos históricos M33/M37/M101 ni convertir organizaciones completadas por un payload nuevo. La RPC nueva y la antigua deben compartir exclusión por identidad durante la convivencia de clientes; se permite redefinición compatible del legado dentro de M126. Membresía activa debe estar aceptada o ser creación directa, además de no eliminada. Verificar creación/reintento como service_role real, denegación anon/authenticated, carrera entre dos conexiones y retorno multi-org sin editar un contexto ajeno. Migración revisada y autorizada antes del despliegue dependiente.
- Precio Solo/Clínica desde la fuente canónica de facturación, con desglose de asientos vigente. Configurar no cobra ni crea una suscripción. No mostrar el precio Solo a una clínica.
- Separar preparación administrativa de disponibilidad para reservas. La revisión final muestra lo guardado y pendientes reales; no anuncia agenda/listado público listo con sólo un slug. Publicación y datos expuestos respetan controles y consentimiento existentes.
- No renumerar pasos históricos en sitio. Versionar/adaptar progreso de forma compatible, reanudar según datos persistidos, conservar horarios/servicios y sus revisiones; borradores separados por identidad y organización. Completados no vuelven al wizard; respuesta perdida, fallo de guardado o retorno OAuth no crean duplicados ni descartan trabajo.
- Propiedad B: `components/onboarding/`, `lib/onboarding/`, acciones/página/resume de onboarding, intención auth estrictamente necesaria, pruebas focales, nueva hoja `styles/onboarding-experience.css` y su import. Propiedad D: página/OG `/book/[slug]`, componentes públicos/booking, estilos `.bl` y `components/public-card/`. B y D acuerdan interfaz compatible de preview antes de cambios compartidos; nadie modifica archivos ajenos sin relevo.
- Diseño: tipografía y tokens Folio, jerarquía clara, identidad propia sin claims inventados, formulario de reserva integrado sin pedir dos veces el servicio seleccionado, estados vacíos cuidados, CTA principal claro. Sin constructor genérico, Tailwind, biblioteca nueva ni fotografías/testimonios ficticios en producto.
- Aceptación: Solo, Clínica con responsable tratante y no tratante; elección/email/OAuth/recarga/multi-org; bootstrap repetido/concurrente; guardados inciertos, permisos y datos ajenos; precio y preparación reales; móvil 360/390, escritorio, teclado, foco, contraste y movimiento reducido. Pruebas sintéticas no acreditan entrega de correo ni proveedores reales. Revisión independiente y vista visible antes de cerrar estética.

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
| 20/09, reparación Docker cerrada sin éxito | A autoriza segundo directorio después de inspección, C preserva `docker-secrets-engine.hold-20260919T233132265Z`. Segundo arranque falla a 23:32:36 UTC de nuevo en dockerInference recién creado. Se detiene el método sin más reinicios/renombres: motor e inventario no verificados, C01 bloqueado. Ubuntu alternó estado sin acciones dirigidas, causa no atribuida. Evidencia privada: `C:/Users/amiun/Documents/Codex/folio-c01-docker-repair-20260919T2325Z/`. C sólo prepara diagnóstico oficial acotado; B recibe slot pesado |
| 20/09, PR de entrega | PR166 en borrador: https://github.com/OsoCordobes/FolioApp/pull/166, cabeza inicial `054e5ac`. Aplicación y SQL en curso; Supabase Preview SKIPPED, no aprobado. Incluye B01/D01/preparador y tablero; B02a se incorporará después de pruebas y revisión. No merge ni despliegue |
| 20/09, CI inicial PR166 | `054e5ac6805e761292f29d855c50591310d2743a`: App CI PASS (2238/2238 unidades, 6 navegador acceso, recuperación71 PASS+14 SKIP/0FAIL, build PASS); SQL PASS. Supabase Preview SKIPPED explícitamente porque no hay cambios en `supabase/`. No deployment asociado al SHA en GitHub. Logs privados `C:/Users/amiun/AppData/Local/Temp/folio-launch-manager-evidence/ci-app-054e5ac.*`. B02a todavía cambia el candidato futuro |
| 20/09, hipótesis Docker alternativa | Reportes primarios describen el mismo socket nuevo con EnableDockerAI=true; resultados contradictorios impiden prometer solución. C prepara experimento de un único flag con copia íntegra/hash, permisos preservados, un arranque y rollback selectivo. D aprueba procedimiento, exige valor efectivo false del nuevo backend y motor respondiendo. Sin ejecución aún; `default-admin` no bloqueado podría sobrescribir el flag. No cambiar políticas ni escalarlas |
| 20/09, B03 reservado | D comienza rama codex/launch-calendar desde `87f444e`, conserva worktree f12d. Reserva M124/lib/db/calendario.ts y pruebas focales; B revisa. A no incorpora este paquete en PR166: requiere migración aditiva previa, evidencia y autorización propias. Cuota observada 50% |
| 20/09, B02a cerrado local | `0bd5ca7e56625736d60bb8df048b88ac0821ccfa`, árbol limpio; D revisa cuatro archivos y aprueba SHA exacto. A integra `ddcf2dc`. Pruebas locales PASS según fila B02; logs privados `C:/Users/amiun/AppData/Local/Temp/folio-b02a-*`. Mismo contrato de servidor/anti-enumeración, sin correo real. El workflow ahora incluye ambos specs de acceso en el mismo runner |
| 20/09, experimento Docker autorizado | Tras revisión D y cierre de gates B, A autoriza una ejecución del procedimiento privado `c01-ai-flag-experiment-UNEXECUTED.md`, hash 8C5D66AC1AB13039543EAB8A0910484ACC212BC48DAFA3E8E109548921CBFF89. Único flag, copia/hash/ACL, un arranque, valor efectivo false y motor respondiendo para aceptar; fallo obliga rollback selectivo y fin del enfoque. Al registrar esta fila sólo se confirmó cierre de procesos y preflight; no hay resultado de arranque aún |
| 20/09, motor Docker recuperado | Arranque único 23:54:27 UTC, backend 23:54:34.580 UTC confirma EnableDockerAI=false efectivo y Server29.3.0 responde. Otros siete ajustes, ACL y atributos idénticos; copias/holds preservados. Resultado privado `folio-c01-docker-repair-20260919T2325Z/c01-ai-20260919T235049335Z/result.json`, hash CAB734CBEC1366702BCD2D224F2C40C4A1FFE368A02D2D768331B8C780D565A1. Motor no acredita restore. Contenedores antiguos folio-local-clinical aparecen activos tras Docker, sin arranque dirigido por C; no se usan para ensayos nuevos |
| 20/09, CI final falló y se conserva | `072d7a6`: 2240/2240 unidades, 7 navegador acceso y SQL PASS; recuperación70 PASS+14SKIP+1FAIL, build no ejecutado. Caso67 falla creando fixture antes de probar rutas: lock no disponible. Logs privados ci-app-072d7a6.log y ci-app-072d7a6-failed.log. No se reejecuta a ciegas ni se publica |
| 20/09, causa reproducible del lock | C demuestra dos rutas distintas con mismo puerto de lock Linux (hash reducido a16384 puertos); no se conoce qué ocupó el puerto en ese CI. A autoriza hash completo mediante socket abstracto Linux y regresión RED/GREEN, misma-ruta/muerte de proceso, sin cambiar Windows ni hacer fallback. Requiere revisión D y nueva CI. Operadores Linux viejos/nuevos no deben compartir destino durante transición; exclusión local no cubre namespaces distintos. Cuota observada47% |
| 20/09, B03 amplía su comprobación de pantalla | B detecta precio de pedidos para COORDINADOR, solicitudes ajenas al alcance y selector sin filtrar. D incorpora RPC mínima de pedidos/selector en M124; sin asignar sigue user_has_scope_over(org,NULL), sin excepción para LISTA/EQUIPO. Hallazgo REST directo M09 pasa a B05 explícito. PG16 nuevo folio-d-b03-pg16-20260920 con volumen propio y red interna; replay por docker exec/psql para preservar guard de loopback, recursos y pruebas reales previos intactos |

| 20/09, Cloudflare corregido | Chrome reconectado. A agregó foliosalud.com mediante la opción de hostname personalizado, guardó una vez y reabrió edición: exactamente dos hostnames, el anterior conservado, Managed y sin pre-clearance, misma sitekey. No se reveló ni rotó la clave secreta. Evidencia privada cloudflare-hostname-readback-20260920.json; registro humano solicitado. No acredita creación de cuenta, correo ni onboarding completo |
| 20/09, SQL B03 detecta frontera real | Replay aislado aplica 118/118 migraciones. Suite se detiene en M113; focal M124 detecta permission denied for table pedido. D reemplaza cuatro proyecciones por helpers privados con controles M122 y wrappers, sin GRANT amplio. Primera base/log y M124 aplicado quedan preservados; versión corregida requiere base nueva y revisión B. Todavía no SQL PASS del paquete |
| 20/09, desfase de disponibilidad | A y B confirman por código: M97 usa DEFAULT CURRENT_DATE UTC y M113 día Córdoba; 00–03UTC produce vigencia de mañana. Lectura productiva sólo de configuración confirma UTC, fechas distintas y M113 sin activar. UI actual usa RPC nuevo, puente antiguo aún habilitado en DB. Se reserva M125 para corrección mínima y regresión independiente del reloj, sin cambiar historia/flags/fechas existentes ni ocultar el fallo con TZ del test. Escritura B espera cierre C para mantener dos autores |

| 20/09, comprobación humana Cloudflare | Titular prueba landing → Probar Folio y responde «Ya no aparece el error». Confirma cierre del bloqueo visible del widget después del hostname; no acredita alta de cuenta, correo, login ni ocho pasos de onboarding. Permanece vigente el resto de B02 |

| 20/09, reforma de onboarding solicitada | Titular considera insuficiente el recorrido actual y pide elegir primero Clínica o Profesional independiente, con onboarding diferente. A confirma prioridad B02b y aplica emil-design-eng; revisión de contrato sólo lectura mientras B termina M125 y D termina M124. Observado: hoy se elige tipo en paso3, paso2 presume profesional y signup muestra precio Solo; bootstrap crea OWNER colegiado por defecto. Reforma debe contemplar servidor/retomar/identidad y precio, no sólo mover el selector |

| 20/09, identidad de página pública | Titular vuelve a señalar pobreza visual y falta de identidad. Elige expresamente «Una base visual de Folio, con identidad del profesional o clínica». D01 aún sin publicar queda como base técnica; D02 requiere revisión visual nueva y coherencia con onboarding/preview/OG. Se conservan antecedentes y pruebas D01; la aprobación previa del manager no cierra la nueva expectativa |

| 20/09, lock Linux aprobado | C entrega c4eadd653f44ae75783acb32273ea73fc8b33a9f; D aprueba commit exacto. RED anterior exit1 por colisión; GREEN Linux2 PASS/1SKIP y Windows1 PASS/2SKIP, crash/readquisición y transición documentadas. Evidencia privada folio-pr166-lock-linux-20260920T001836065Z. A integra junto al próximo paquete para evitar CI redundante. Saldo observado46%, compartido |

| 20/09, recorrido comercial Google | Titular explicita Instagram → página pública → reserva → Google Calendar → agenda/flujo Folio. Código actual: reserva confirmada se persiste en Folio y M107 crea intención saliente; Google externo entra como bloqueo, eventos propios se excluyen de inbound. Mover/cancelar evento propio desde Google no equivale hoy a editar turno Folio. Falta cron sync-google en vercel.json. A explica frontera y consulta si se gestionarán turnos también desde Google; C prepara traza/readiness sólo lectura, sin activar envíos |

| 20/09, base de próxima experiencia | A integra lock aprobado como a22399f y M125 aprobado como fd7038b. M125 corrige CI dependiente de hora sin ocultar la regresión; todos66spec SQL del paquete B PASS. PR166 ahora requiere M125 productiva antes de despliegue, previa autorización concreta. B03/M124 permanece separado. Saldo observado44%; siguiente escritura B02b/D02 sobre esta base integrada, con fronteras del contrato anterior |

| 20/09, nuevos paquetes autorizados | B02b y D02 asignados sobre f769944 con Sol/High, ramas propias y propiedad de archivos según contrato. D entrega primero vista pura compartida/API a B; ambos presentan evidencia y revisión cruzada. CI base f769944 en curso; Supabase Preview SKIPPED porque la rama Git no está asociada a una Supabase Branch, no por ausencia de cambios SQL. No se lo presenta como entorno hospedado aprobado |

| 20/09, salida del onboarding | Titular no encuentra vuelta al home y reporta paths confusos. A verifica logo href=/ en ambos headers y raíz autenticada derivada a /hoy por route-decision; organización incompleta puede retornar al wizard. B02b incorpora enlace explícito y corrección focal de navegación con pruebas; no basta sólo cambiar apariencia del logo. Titular reitera que D02 necesita mejora visual sustancial |

| 20/09, CI corregida aprobada | SHA f76994490e5f25797f6f83632fa5fc7ebe74a30c: App run35479475239 SUCCESS, 2240/2240 unidades, 7 navegador acceso, recuperación73 PASS +15 SKIP /0 FAIL y build PASS. SQL run35479475230 SUCCESS, 118 migraciones y 66 specs. Supabase Preview SKIPPED por rama no asociada; no acredita Auth/Storage hospedados. Logs y resumen privados ci-app-f769944.log, ci-sql-f769944.log, ci-all-f769944.json. Fallo anterior conservado |

| 20/09, fundación compartida D02 | D entrega c3c595fa07437d2d17dd4a29233e0792884e6dc9: vista pública pura compartida y preview de borrador con reserva inerte. Tipos/lint focal PASS; verificación visual aún pendiente, servidor 4434 no llegó a escuchar y fue detenido. B recibe contrato y SHA; D continúa reforma visual, este hito no es aprobación estética |

| 20/09, revisión de contrato B02b | Revisión independiente de M126 exige exclusión común entre bootstrap antiguo/nuevo, membresías aceptadas, pruebas con service_role real y retorno multi-org seguro. A autoriza resolverlo dentro de migración nueva, manteniendo archivos históricos y privilegios OWNER. La raíz también está interceptada por MFA antes del helper de rutas: corregir excepción exclusivamente pública y verificar middleware completo |

| 20/09, cuota después de la base verde | Saldo compartido 40%; B02b/D02 siguen siendo los dos frentes de implementación. Se reserva margen para pruebas finales, revisión e integración; no repetir suites base verdes ni abrir nuevas campañas |

## Próxima decisión del manager

Cloudflare guardado, verificado y titular confirma desaparición del error. PR166 incluye B01, B02a, D01, lock Linux y M125 revisados. CI de f769944 aprobada; completar B02b/D02, revisión independiente y vista previa visible antes de preparar publicación con las migraciones necesarias. B03/M124 sigue separado y deberá desactivar su auto-Preview Vercel antes de cualquier push. Motor Docker operativo; C01 aún requiere ensayo completo. La decisión sobre gestionar turnos también desde Google continúa pendiente; no prometer importación de pacientes ni activar sincronización productiva por suposición.
