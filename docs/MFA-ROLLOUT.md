# MFA del personal: preparación, activación y recuperación

Estado: implementado en M101 y en la aplicación, **sin activar ni desplegar en
producción**. La inscripción usa TOTP (una aplicación autenticadora). Antes del
piloto hace falta verificar el circuito con Supabase Auth y Storage reales.

## Qué protege

El personal con una membresía vigente en cualquier organización activa queda
sujeto a la política global: OWNER, DIRECTOR, PROFESIONAL, COORDINADOR y ASISTENTE.
Cambiar de organización o entrar al portal de pacientes con la misma cuenta no
evita MFA. Los pacientes sin membresía profesional y sin MFA conservan su política
de primer factor. Una cuenta enrolada queda registrada como protegida incluso si
se retiran todos sus autenticadores; quitar un factor no desactiva la protección.

El servidor valida al usuario con `getUser()` y consulta una RPC del propio usuario.
PostgREST valida el JWT. Para una cuenta protegida se exige AAL2 en ese JWT y en
la fila vigente de `auth.sessions`, con el mismo usuario, sin vencimiento y con
`factor_id` enlazado a un factor todavía verificado del mismo usuario. Los roles
y bajas se leen de las tablas actuales, nunca de metadatos editables del usuario.
Así también se rechaza un JWT AAL2 anterior a una revocación o degradación de sesión.

M101 agrega políticas restrictivas en tablas públicas con RLS y en Storage.
Protege además un inventario explícito de 22 funciones SECURITY DEFINER existentes,
preservando sus OID, permisos, firmas, argumentos opcionales y volatilidad. Las
nuevas funciones privilegiadas que se expongan a usuarios deben adoptar el mismo
guard; una prueba de inventario detecta omisiones. Las tablas nuevas con RLS deben
incorporar la política restrictiva. Un trabajo de fondo o webhook sin actor humano
mantiene sus credenciales propias; las operaciones service-role iniciadas por un
usuario validan su sesión antes del acceso privilegiado.

## Despliegue por etapas

1. Aplicar M101 antes del código dependiente. `application_ready=false` y
   `staff_enforce_after=NULL` impiden que la instalación sola bloquee cuentas,
   incluso las que ya tenían factores verificados. Es una etapa transitoria;
   **no habilita un piloto protegido**.
2. Desplegar el código y comprobar que `/seguridad/mfa`, su ayuda de recuperación,
   login, recuperación de contraseña y cierre de sesión funcionan. Activar TOTP
   en la configuración de Supabase Auth. Si existen factores de otro tipo,
   resolver su acceso y migración a TOTP antes del piloto; esta interfaz ofrece
   TOTP y no desafíos SMS/WebAuthn.
3. Desde una operación administrativa controlada, llamar
   `public.mfa_enable_preparation(p_reason => 'referencia al cambio y revisión de despliegue')`.
   Sólo service_role puede ejecutar esta función; el interruptor es de una vía.
   Desde entonces las cuentas enroladas exigen el segundo factor. El personal
   todavía sin factor puede inscribirse durante esta preparación.
4. Enrolar a todo el personal y registrar un autenticador de respaldo en otro
   dispositivo. Verificar inicio de sesión, desafío, refresh de cookies, portal
   con cuenta dual, exportación, cambios de organización, bajas de miembros,
   retiro de factor y recuperación con cuentas sintéticas de cada rol.
5. Antes del piloto, llamar desde la misma vía administrativa
   `public.mfa_set_staff_enforcement(p_after => now(), p_reason => 'referencia al ensayo y aprobación del piloto')`.
   La función rechaza la activación si existe personal activo sin factor
   verificado. Los nuevos miembros quedan sujetos a MFA y deben inscribirse antes
   de continuar. Verificar que AAL1 no puede leer ni escribir por PostgREST ni
   Storage, y que AAL2 conserva los accesos autorizados.

Ambas funciones registran cambios en `folio_mfa_private.policy_history`, que no
es accesible para usuarios. El motivo debe identificar el operador, la revisión
y el ticket; no incluir PHI, claves, códigos ni secretos. Consultar también la
fila de política al cerrar el cambio. No alcanza con modificar una variable de
entorno ni con mostrar la pantalla de MFA.

Un rollback de código debe conservar el circuito de MFA compatible. Poner
`staff_enforce_after=NULL` mediante la función auditada sólo suspende la exigencia
para personal aún no enrolado: **no libera cuentas ya protegidas**. No borrar sus
registros para solucionar un problema de acceso ni desactivar RLS.

## Recuperar acceso sin convertir el correo en un bypass

La primera opción es desafiar el autenticador de respaldo. El enlace “Perdí mi
autenticador” explica el proceso y permite contactar al soporte existente.
Cambiar la contraseña o recibir un enlace por correo no elimina MFA.

Si se perdieron todos los factores, la recuperación requiere intervención
administrativa: comprobar identidad por un procedimiento independiente del email
y contrastar la relación con la organización mediante un contacto previamente
verificado. Exigir revisión de un segundo operador, documentar evidencia mínima
y aprobación en un canal de soporte seguro, sin datos clínicos. Este procedimiento
de identidad debe validarse operativamente antes del piloto; no está automatizado.

Tras aprobarla, el operador autorizado revoca todas las sesiones y retira los
factores perdidos usando las funciones administrativas de Supabase Auth. Conserva
el registro de cuenta protegida. El usuario vuelve a autenticar el primer factor,
inscribe un nuevo TOTP y completa su desafío. Hasta obtener AAL2 con la nueva sesión
y factor vigentes, las funciones y RLS mantienen cerrado el acceso a datos.
Registrar el resultado, avisar al titular por el canal previamente verificado y
ensayar que los tokens anteriores siguen denegados. No entregar códigos de bypass,
no retirar factores basándose sólo en un email y no pedir contraseñas/QR/códigos.

## Evidencia y límites

Las pruebas locales usan PostgreSQL 16 y filas/JWT sintéticos. Comprueban políticas,
cuentas duales, permisos, revocación, firma con argumentos opcionales, cierre ante
errores de autorización y acciones directas antes de service-role. Los secretos de
enrolamiento sólo existen durante la configuración de la interfaz y no se guardan
en almacenamiento del navegador ni se registran en errores.

Revisión independiente del 8 de septiembre: 26 pruebas unitarias de MFA pasaron,
incluidas siete nuevas sobre el middleware ejecutado, conservación de cookies
rotadas, errores 403/503 sin detalles del proveedor y accesos directos mediante
`getActiveSession`, `listUserMemberships`, `setActiveOrg` y `getPacienteSession`.
TypeScript y lint de la nueva prueba pasaron. Un replay aislado de 95 migraciones
hasta M101 y su especificación ampliada pasó en PostgreSQL 16
(`folio_test_mfa_independent_1788889088320`): también rechaza una sesión de otro
usuario, un factor verificado ajeno y un factor aún no verificado aunque el JWT
declare AAL2. No fue necesario cambiar el guard para esos casos. El código oficial
de [Auth](https://github.com/supabase/auth/blob/master/internal/api/mfa.go) exige
AAL2 para agregar otro factor cuando ya hay uno verificado y para retirar un
factor verificado; confirmar este comportamiento en la versión desplegada sigue
formando parte del ensayo real.

Una URL firmada de Storage ya emitida es una credencial independiente del JWT de
sesión: la revocación de sesión/MFA no debe presentarse como revocación inmediata
de esa URL. Mientras haya lectores de firmas que las emitan, su acceso puede
continuar durante el TTL (300 segundos en los lectores revisados). Para exigir
comprobación de sesión en cada descarga hace falta el proxy autenticado de
adjuntos; la revisión de MFA no modificó esos lectores ni la migración de
representación/consentimientos. Ningún control puede retirar bytes ya descargados.

**Pendiente:** ensayo real de Auth (firma, challenge, cookies y retiro de factores),
Storage API, recuperación y recorrido visual autenticado. La revisión automática
rechazó iniciar el daemon Docker dedicado, con un motivo genérico sin detalle;
no se intentaron vías alternativas tras el rechazo. Los stubs no sustituyen esas
pruebas y no autorizan por sí solos la activación para pacientes reales.

Referencias primarias consultadas: [MFA de Supabase](https://supabase.com/docs/guides/auth/auth-mfa),
[TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[sesiones](https://supabase.com/docs/guides/auth/sessions) y
[modelo oficial de sesiones, AAL y factor asociado](https://github.com/supabase/auth/blob/master/internal/models/sessions.go).
