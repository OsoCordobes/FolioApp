# Folio — tablero único de lanzamiento

Actualizado: 19 de septiembre de 2026. Responsable: A, manager.
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
- Dos permisos de escritura de implementación: B y C inicialmente. D sólo inspecciona y verifica hasta recibir relevo explícito. La edición administrativa del tablero pertenece a A.
- B y C no editan migraciones sin reserva explícita del manager. No hay migración nueva reservada en esta primera ola.
- Ningún trabajador hace merge, despliegue, mutación productiva, envío real, cargo, rotación de claves ni eliminación de evidencia. Preparar paquete concreto para autorización del titular cuando corresponda.
- Revisiones: D revisa B/C; B revisa D; A integra después de revisión y checks. Un autor no aprueba su propio cambio.
- Puertos de aplicación reservados: B 4430, C 4432, D 4434. Usar runners aislados del repositorio y comprobar ocupación antes de iniciar. Un puerto ocupado no autoriza matar procesos ajenos.
- Runtime clínico previo `C:/Users/amiun/Documents/Codex/folio-clinical-runtime`: evidencia preservada, no reutilizar su base para escrituras ni resetearla. C prepara destino nuevo y dedicado para restauración; B/D usan respuestas controladas mientras no reciban un entorno asignado.
- No copiar `.env.local` productivo a worktrees. Antes de CLIs que puedan escribir configuración, preservar copia protegida fuera del repo. Nunca imprimir secretos ni activar proveedores en pruebas automatizadas.
- Leer `C:/Users/amiun/.codex/RTK.md`; usar salida acotada y conservar logs completos. `AGENTS.md` no está versionado: leer también el del Escritorio y `CLAUDE.md` de cada checkout.

## Equipo y cuota

| Sesión | Modelo/esfuerzo solicitado | Primera asignación | Permiso inicial |
|---|---|---|---|
| A — Manager | GPT-6 Astra / High (selección del titular; no autoconfirmar cambio de modelo) | Tablero, coordinación y revisión de bloqueos | Documentación de coordinación |
| B — Acceso y producto | GPT-5.6 Sol / High | B01 | Escritura en ámbito asignado |
| C — Continuidad y proveedores | GPT-5.6 Sol / High | C01 | Escritura en ámbito asignado |
| D — Experiencia y verificación | GPT-5.6 Sol / High | D00, después revisión B01 | Sólo lectura/verificación al inicio |

Cuota observada al iniciar ejecución: **67% restante**, reinicio **26/09/2026 14:59:03 UTC**. Es compartida con otras tareas; cambios de saldo no se atribuyen automáticamente a un trabajador. Presupuesto: saldo actual + dos ciclos. Reservar aproximadamente 15 puntos por ciclo para integración/incidentes. Velocidad estándar; no convertir porcentajes a horas/tokens prometidos.

Medir antes/después de cada paquete. Tras tres intentos sin nueva evidencia, detener ese enfoque, describir el bloqueo y cambiar de estrategia. No lanzar auditorías amplias ni subagentes sin una subtarea acotada, ahorro probable y cupo disponible.

## Estado de tareas

Estados: `pendiente`, `asignado`, `en curso`, `en revisión`, `aprobado local`, `pendiente de autorización`, `comprobado en destino`, `bloqueado por dependencia`. Naturaleza: `defecto observado`, `defecto reproducido`, `evidencia pendiente`, `decisión humana`, `mejora acordada`.

| ID | Prioridad / naturaleza | Responsable / revisor | Estado | Aceptación y dependencia |
|---|---|---|---|---|
| A00 | Alta / coordinación | A | en curso | Tablero persistido; referencias históricas corregidas; B/C/D creados con modelo, SHA, ámbito y aislamiento comprobados |
| B01 | Bloqueante / defecto observado, causa pendiente | B / D | asignado | Landing → Probar Folio → registro usable; diagnóstico reproducible y corrección focal; casos negativos y reintentos; comprobación humana en dispositivo original. Depende de configuración externa si la causa lo exige |
| B02 | Alta / evidencia pendiente | B / D | pendiente, después de B01 | Registro, confirmación, ingreso, contraseña, MFA y onboarding reanudable; sin cuentas/organizaciones duplicadas ni arreglos manuales de base |
| C01 | Bloqueante / evidencia pendiente | C / D | asignado | Restauración aislada completa de base/Auth/Storage/configuración; login y descifrado reales, inventario/hashes, tiempo medido; distinguir local de alojada y custodia independiente |
| C02 | Alta / decisión humana + evidencia pendiente | C / A | pendiente | Copia externa y material portable probado fuera del perfil Windows; par Upstash actualizado; custodio y destino autorizados |
| B03 | Alta / brecha de implementación identificada | B / D | pendiente | Calendario semana/mes para ASISTENTE y COORDINADOR, sin ampliar acceso clínico/financiero; pruebas directas y de interfaz |
| B04 | Alta / mejora acordada + evidencia pendiente | B / D | pendiente | Política de nuevas atenciones adultas efectiva en servidor/base, DOB desconocida bloquea atención; límites de 18 años y concurrencia; históricos/borradores/recibos preservados |
| B05 | Alta / evidencia pendiente | B / D | pendiente | MFA y recuperación de cuenta, controles separados de adjuntos/disponibilidad/consentimiento; roles, revocación y dos organizaciones; activar sólo con paquete revisado |
| B06 | Alta / evidencia pendiente | B / D | pendiente | Portal adulto, CSV, archivos y exportación completa autorizada; reutilizar pruebas ya aprobadas y cubrir sólo huecos/diffs |
| C03 | Alta / evidencia pendiente | C / D | pendiente | Auth/SMTP y correo Folio entregados a buzones controlados; cola retenida revisada; fallos/cuotas visibles; no activar WhatsApp incidentalmente |
| C04 | Alta / evidencia pendiente | C / D | pendiente | Mercado Pago Solo/Clínica/asientos/cancelación/mora/conciliación; duplicados, desorden y respuesta perdida; distinguir sandbox de cargo real |
| C05 | Alta / brecha de programación + evidencia pendiente | C / D | pendiente | Google conecta, sincroniza entrada/salida, bloquea horarios y se recupera de revocación/webhook ausente; programar sync periódico después del ensayo autorizado |
| D00 | Alta / mejora acordada | D / A | asignado, sólo lectura | Revisión acotada del perfil público y propuesta concreta sobre datos existentes, móvil/escritorio/Solo/Clínica; plan de aceptación de auth. Sin implementar todavía |
| D01 | Alta / mejora acordada | D / B | pendiente de permiso de escritura | Página pública profesional con foto/identidad, presentación, servicios, reserva móvil y vista previa social; perfiles incompletos, contraste, teclado y zoom; aprobación visual |
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

## Próxima decisión del manager

Confirmar creación/modelo/rutas de B/C/D, recibir sus primeros hitos, persistir identificadores y evidencias en este tablero. Priorizar B01 y C01. No iniciar otros paquetes ni pedir al titular que repita el recorrido clínico cerrado.
