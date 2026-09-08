# Representación y consentimiento por acto

Estado: implementación técnica local. Requiere revisión de los profesionales
responsables y asesoría jurídica de Córdoba antes del piloto. No certifica
capacidad jurídica, validez de un documento ni una firma digital certificada.

## Personas y decisiones

El paciente, su representante y un contacto de emergencia son personas distintas.
Compartir teléfono, correo o domicilio no acredita identidad ni representación.
Registrar un representante no cambia `paciente.cuenta_id` ni abre una cuenta a su
nombre. Un contacto de emergencia no habilita firmas ni lectura clínica.

| Evaluación profesional para el acto | Evidencia que puede registrarse |
| --- | --- |
| Pendiente | Fundamento y participación; ninguna firma atribuida |
| Autónomo | Firma del paciente |
| Asistido | Firma del paciente y firma separada del representante |
| Representado | Firma del representante, con participación del paciente o razón documentada de su imposibilidad |

La edad y el nombre de una plantilla no eligen al firmante. El profesional debe
evaluar comprensión, autonomía progresiva, acto, riesgos, conflictos, restricciones
y participación. El plazo de revisión lo elige para ese acto; el sistema no inventa
una duración universal ni un vencimiento legal. Una evaluación pendiente permite
seguir documentando la atención, pero no se presenta como consentimiento obtenido.

## Trabajo en el consultorio

1. Registrar la identidad del representante, vínculo declarado, documentación
   examinada, restricciones, período y alcances expresamente acreditados.
2. Comprobar por separado identidad y vínculo. La confirmación conserva el miembro
   evaluador, fecha y auditoría. Los antecedentes incompletos quedan pendientes;
   se carga un nuevo registro completo sin reescribir la historia anterior.
3. Documentar la evaluación para la plantilla y su texto completo. Registrar
   fundamento, participación, riesgos y fecha de nueva revisión.
4. Si corresponde firmar, identificar verbalmente a cada participante. En modo
   asistido, conservar primero el dibujo del paciente y después el del
   representante. El lienzo se limpia al cambiar de participante o evaluación.
5. Ante error de consulta o identidad/acreditación ilegible, revisar antes de
   firmar. Ante respuesta incierta, recargar la lista antes de repetir: no borrar
   archivos que podrían pertenecer a un consentimiento ya confirmado.

Una representación verificada no puede volver a pendiente, cambiar de identidad,
restricciones o alcance, ni reactivarse tras revocación. Se revoca y se registra
otra. Retirar una evaluación impide nuevas firmas sobre ella; no altera una firma
histórica. Revocar un consentimiento conserva su evidencia y motivo. Los dibujos
son evidencia declarada y no demuestran por sí solos la identidad física del autor.

## Portal y acceso

El portal propio sólo ofrece evaluaciones autónomas, vigentes, preparadas por un
profesional para esa ficha y todavía sin firma registrada. El paciente no puede
crear ni aprobar su propia evaluación. Una cuenta clínica que también es paciente
conserva el control MFA del personal.

Los alcances `AGENDA` y `ENTREGA_REVISADA` conservan lo acreditado; esta entrega no
implementa acceso delegado al portal. El representante participa desde el
consultorio. Agenda no concede narrativa clínica y solicitar una entrega no la
aprueba. Un futuro portal delegado requiere identidad de cuenta, autorización
explícita por alcance, vigencia y revocación, además de validación profesional.

Las firmas se abren mediante `/api/consentimientos/[id]/firma` (segundo participante:
`?participante=1`). Cada petición valida sesión/MFA, la fila del consentimiento y
el acceso actual a la ficha mediante RLS antes de descargar con el cliente de
servidor. Respuestas privadas sin caché, tipos permitidos y comprobación del hash
cuando está registrado. No existe fallback a URL firmada. Un permiso retirado
impide nuevas peticiones; ninguna aplicación puede retirar una copia que alguien
ya descargó mientras tenía permiso.

## Evidencia y conservación

M103 añade evaluación, estado de acreditación, instantáneas de identidad cifrada,
texto completo y versión, participantes con rol/referencia individual, rutas y
SHA-256 de los archivos, autor y hora. SQL vuelve a verificar representación y
evaluación dentro de la transacción y bloquea modificaciones posteriores. El
hash permite detectar cambios de bytes al abrir; no equivale a certificado de
firma. La inspección PNG/PDF valida contenedores básicos, no es antivirus ni
decodificación completa.

Los consentimientos anteriores conservan sus datos originales con la etiqueta
`LEGADO_PENDIENTE`; no se reconstruyen texto leído, autores o firmas ausentes.
Las representaciones previas quedan pendientes de acreditación. Los archivos
huérfanos de un intento interrumpido se conservan hasta una conciliación revisada;
no hay limpieza automática que pueda borrar evidencia confirmada.

## Despliegue coordinado

1. Aplicar M103 aditiva con `folio_consent_private.policy.enforced = false`.
   La aplicación anterior sigue registrando evidencia histórica y abriendo sus
   archivos; esos registros no se convierten en evidencia revisada. No se activa
   ningún control en producción como parte de esta implementación local.
2. Desplegar las nuevas pantallas, acciones y ruta de descarga. La aplicación nueva
   ya exige evaluación revisada para firmar, independientemente del interruptor.
3. Validar con profesionales los textos/versiones, decisiones, conflictos,
   urgencias, revocación y representación; ensayar con usuarios sintéticos en
   Supabase real (Auth + Storage + RLS + MFA) y completar revisión de históricos.
4. Un operador autorizado ejecuta con `service_role`
   `public.consent_enable_reviewed_signatures(p_reason)` con referencia de la
   revisión y del despliegue (mínimo 20 caracteres). La activación es unidireccional
   y conserva fecha y primer motivo. Desde entonces SQL rechaza firmas de usuario
   sin evaluación y Storage cierra lectura directa que permita emitir URLs bearer.
   Usuarios autenticados y anónimos no pueden activar ni editar el interruptor.
5. Probar nuevamente revocación, permisos y lectura de evidencia anterior. Tras
   activar, no volver a una versión de aplicación que dependa de lectura directa
   o firmas sin evaluación; corregir hacia adelante preservando los originales.

La importación de antecedentes por un proceso confiable sin actor autenticado
sigue siendo posible, siempre como legado pendiente; nunca recibe el estado de
evidencia revisada. No usar esa vía para representar acciones de usuarios.

## Verificación y pendientes

Las pruebas SQL incluyen expansión sin bloqueo prematuro y cierre activado,
permisos, identidad/vínculo obligatorios, inmutabilidad, regresión de estado,
revocación, texto/versión, participantes separados, hashes ausentes y archivos
fuera de alcance. Las pruebas de acciones e interfaz cubren evaluación pendiente,
asistencia sin representante, consultas fallidas y descarga privada repetida.

La base local es PostgreSQL 16 con stubs de Auth/Storage: no prueba el servicio real
de Supabase ni el funcionamiento de sus sesiones, MFA, cargas y descargas extremo
a extremo. El arranque de un daemon aislado fue rechazado por la revisión
automática con motivo genérico; no se intentaron alternativas para eludirlo.

Referencias oficiales para revisión humana, consultadas el 08/09/2026:
[Código Civil y Comercial, art. 26](https://www.argentina.gob.ar/normativa/nacional/235975/texto),
[Ley 26.529 actualizada](https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432/actualizacion)
y [Decreto 1089/2012](https://www.argentina.gob.ar/normativa/nacional/decreto-1089-2012-199296/texto).
La selección de reglas concretas y documentación admisible para quiropraxia,
cardiología y psicología en Córdoba sigue pendiente de aprobación profesional y
jurídica. No presentar esta implementación como certificación de cumplimiento.
