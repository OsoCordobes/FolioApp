# Acuerdo de Tratamiento de Datos (DPA)

**Data Processing Agreement — Ley 25.326 de Protección de Datos Personales (Argentina) y normativa complementaria**

> **Naturaleza de este documento.** Esta es una **plantilla** de acuerdo de tratamiento de datos que forma parte integrante de los Términos y Condiciones de Folio. Se celebra entre el profesional o institución que contrata el Servicio (el **Responsable**) y Folio (el **Encargado**). No constituye asesoramiento legal; ante dudas específicas de tu jurisdicción o de tu obra social/prepaga, consultá con un profesional del derecho. La aceptación in-app de este acuerdo es opcional y, cuando exista, queda registrada en el audit log con fecha, versión e identidad de quien acepta.
>
> **Última actualización:** 6 de julio de 2026 · **Versión:** 1.0

---

## 1. Partes y definiciones

**1.1. Partes.**

- **Responsable del tratamiento** (en adelante, el **"Responsable"** o la **"Clínica"**): el profesional de la salud, consultorio o institución que contrata el Servicio Folio y que determina las finalidades y los medios del tratamiento de los datos personales y de salud de sus pacientes.
- **Encargado del tratamiento** (en adelante, el **"Encargado"** o **"Folio"**): Folio, en su carácter de proveedor de software como servicio (SaaS), que trata los datos personales **por cuenta y en nombre del Responsable**, siguiendo sus instrucciones.

**1.2. Definiciones.** Los términos empleados en este acuerdo tienen el significado que les asigna la **Ley 25.326** de Protección de Datos Personales, su Decreto reglamentario 1558/2001 y las Disposiciones de la Agencia de Acceso a la Información Pública (AAIP). En particular:

- **Datos personales:** información de cualquier tipo referida a personas físicas determinadas o determinables.
- **Datos sensibles / de salud (PHI):** datos referidos a la salud, historia clínica, diagnósticos, tratamientos, medicación y demás información asistencial de los pacientes. Reciben la máxima protección de la Ley 25.326 (art. 7 y 8) y de la **Ley 26.529** de Derechos del Paciente.
- **Datos identificatorios (PII):** nombre, DNI, contacto, domicilio y demás datos que identifican a una persona.
- **Titular de los datos:** la persona física a la que se refieren los datos (el paciente, o el propio profesional respecto de sus datos de cuenta).
- **Tratamiento:** toda operación o conjunto de operaciones (recolección, conservación, uso, cesión, supresión, etc.) sobre datos personales.
- **Subencargado (subprocesador):** tercero contratado por el Encargado para prestar parte del Servicio y que, en ese marco, trata datos por cuenta del Responsable.
- **Incidente de seguridad / brecha:** todo acceso, divulgación, pérdida, alteración o destrucción no autorizada de datos personales. El procedimiento de respuesta se detalla en el documento complementario **breach-notification-SOP.md**.

---

## 2. Objeto y roles

**2.1. Objeto.** Este acuerdo regula el tratamiento que Folio, como Encargado, realiza sobre los datos personales cuyo Responsable es la Clínica, en el marco de la prestación del Servicio (gestión de turnos, agenda, historia clínica electrónica, comunicaciones con pacientes, facturación de la suscripción y funcionalidades conexas).

**2.2. Distribución de roles.**

- La **Clínica es el Responsable** de los datos de sus pacientes: determina qué datos se cargan, con qué finalidad asistencial y por cuánto tiempo, y es quien mantiene la relación con el titular (el paciente).
- **Folio es el Encargado**: aloja, cifra, procesa y pone a disposición los datos exclusivamente para que la Clínica preste su servicio de salud. Folio **no** decide las finalidades del tratamiento clínico, **no** vende los datos y **no** los usa para fines propios distintos de operar y mejorar el Servicio de forma agregada y anonimizada (ver §7).
- Respecto de los **datos de cuenta del propio profesional** (nombre, email, matrícula, datos de facturación de la suscripción), Folio actúa como Responsable, según lo descripto en la [Política de Privacidad](../../app/(public)/privacidad/page.tsx).

---

## 3. Instrucciones del Responsable

**3.1.** El Encargado tratará los datos personales **únicamente conforme a las instrucciones documentadas del Responsable**, que quedan materializadas en: (a) este acuerdo, (b) los Términos y Condiciones, (c) la Política de Privacidad, y (d) las acciones que el Responsable ejecuta dentro de la aplicación (cargar un paciente, agendar un turno, exportar datos, solicitar la supresión de una cuenta, etc.).

**3.2.** Si el Encargado considera que una instrucción infringe la Ley 25.326, la Ley 26.529 u otra normativa aplicable, lo informará al Responsable sin dilación.

**3.3.** El Encargado no tratará los datos para finalidades propias ajenas al Servicio, salvo el uso de métricas **agregadas y k-anónimas** descripto en §7, del que el Responsable puede excluirse (opt-out).

---

## 4. Obligaciones de seguridad del Encargado

El Encargado implementa las siguientes medidas técnicas y organizativas, acordes al nivel de sensibilidad de los datos de salud (Ley 25.326 art. 9; Disposición AAIP sobre medidas de seguridad):

**4.1. Cifrado.**

- **Cifrado columnar AES-256-GCM app-side** de los datos identificatorios (PII) y de salud (PHI) **antes** de que ingresen a la base de datos. Las claves de cifrado residen en variables de entorno seguras, **nunca** en el código fuente ni en el repositorio.
- Cifrado **en tránsito** (TLS) y **en reposo (at-rest)** en toda la infraestructura de almacenamiento.

**4.2. Aislamiento multi-tenant por RLS (Row Level Security).** PostgreSQL aplica políticas de fila que garantizan que **cada organización solo accede a los datos de su propia organización**. Los roles con menor privilegio (p. ej. asistentes administrativos) **no** acceden a la PHI clínica. Las operaciones privilegiadas o cross-tenant corren en funciones `SECURITY DEFINER` acotadas y auditables.

**4.3. Auditoría (audit log inmutable).** Registro inmutable de las lecturas y escrituras sobre tablas sensibles, con identidad del actor, marca temporal e IP/user-agent cuando corresponde. **Retención de 10 años** (Ley 26.529 art. 18).

**4.4. Integridad append-only de la historia clínica.** Las notas clínicas son **append-only**: las correcciones se realizan por **enmienda firmada**, nunca por sobrescritura (`UPDATE`) ni borrado físico, preservando la trazabilidad exigida por la Ley 26.529.

**4.5. Control de acceso.** Autenticación gestionada por proveedor especializado; contraseñas nunca almacenadas en claro; disponibilidad de segundo factor (MFA/TOTP) y de revocación de sesiones para las cuentas profesionales.

**4.6. Backups.** Copias de resguardo cifradas con retención mínima de 30 días, que permiten la recuperación ante incidentes.

**4.7. Confidencialidad del personal.** El personal del Encargado con acceso técnico a la infraestructura está obligado a **deber de secreto** (Ley 25.326 art. 10) y accede a datos solo bajo el principio de mínimo privilegio y necesidad operativa.

**4.8. Minimización en integraciones externas.** Las integraciones que envían datos fuera del Servicio (emails, WhatsApp, calendario) transmiten **únicamente** los datos estrictamente necesarios (nombre y datos del turno) y **nunca** PHI clínica (ver §6 y la Política de Privacidad §4).

---

## 5. Retención y supresión

**5.1. Datos clínicos de pacientes.** Se conservan **10 años** desde la última atención (Ley 26.529 art. 18). La supresión de un paciente se ejecuta por **pseudonimización**: se remueve la identidad (PII) pero se retienen los datos clínicos anonimizados durante el plazo legal.

**5.2. Datos del profesional (cuenta).** Se conservan mientras la cuenta esté activa. Tras el cierre, un período de gracia para reactivación y luego eliminación, salvo los registros contables/fiscales de conservación obligatoria.

**5.3. Logs técnicos.** Retención por defecto acotada (del orden de 90 días) para logs operativos; el audit log de tablas sensibles se conserva según §4.3.

**5.4. Devolución y borrado al finalizar el acuerdo.** Finalizado el vínculo contractual, y una vez cumplidos los plazos legales de retención que obligan al Responsable, el Encargado devolverá o suprimirá los datos según las instrucciones del Responsable. La supresión respeta siempre los mínimos legales de conservación (Ley 26.529).

---

## 6. Subencargados (subprocesadores)

**6.1.** El Responsable **autoriza** al Encargado a valerse de los siguientes subencargados, cada uno limitado a su finalidad y sujeto a obligaciones de confidencialidad y seguridad equivalentes a las de este acuerdo:

| Subencargado | Finalidad | Datos que trata | Ubicación |
|---|---|---|---|
| **Supabase** | Hosting de la base de datos (PostgreSQL) y autenticación | PII y PHI (cifrados app-side) | São Paulo, Brasil (región `sa-east-1`, Sudamérica) |
| **Vercel** | Hosting de la aplicación web (edge/serverless) | Requests en tránsito; no almacena PHI de forma persistente | Funciones fijadas a la región Sudamérica (`gru1`) |
| **Mercado Pago** | Procesamiento de los pagos de la suscripción | Datos del pagador (nombre, email, medio de pago). **Nunca** datos clínicos ni de pacientes | Argentina |
| **Resend** | Envío de emails transaccionales (confirmaciones/recordatorios de turno, invitaciones, avisos de facturación) | Nombre y email del destinatario, contenido del aviso. **Nunca** PHI clínica | Internacional |
| **Sentry** | Monitoreo de errores de la aplicación | Metadatos de error con scrubbing automático que excluye PHI y datos sensibles | Internacional |
| **PostHog** | Analytics de producto (**solo con opt-in** en el aviso de cookies) | Eventos de uso de la aplicación, sin PHI ni datos de pacientes | Internacional |
| **Meta WhatsApp** | Mensajes a pacientes autorizados por el Responsable | Nombre y datos del turno. **Nunca** PHI clínica | Internacional |
| **Google Calendar** | Sincronización opcional de turnos | Título genérico + hora. **Nunca** diagnóstico ni motivo de consulta | Internacional |

> Los subencargados marcados como "Internacional" implican una **transferencia internacional de datos**. La transferencia se ampara en las excepciones y garantías previstas por la Ley 25.326 (art. 12) y las Disposiciones de la AAIP en la materia, y se limita a datos no clínicos o debidamente minimizados/cifrados según la tabla. Los datos de salud (PHI) residen alojados en la región Sudamérica (São Paulo, Brasil).

**6.2. Alta y baja de subencargados.** El Encargado podrá incorporar o sustituir subencargados para prestar o mejorar el Servicio. En tal caso **notificará** al Responsable con antelación razonable (por email y/o dentro de la aplicación), dándole la posibilidad de objetar por motivos razonables de protección de datos. La versión vigente de esta lista se refleja además en la Política de Privacidad §4.

**6.3. Responsabilidad.** El Encargado responde frente al Responsable por el cumplimiento de las obligaciones de sus subencargados en lo relativo al tratamiento de los datos objeto de este acuerdo.

---

## 7. Uso de datos agregados y anonimizados

**7.1.** El Encargado podrá generar **métricas agregadas y k-anónimas** (k≥5, y k≥10 para precios) para ofrecer comparativas de comunidad a los profesionales (p. ej. ticket promedio por especialidad). Estas métricas **no permiten reidentificar** a un consultorio ni a un paciente.

**7.2.** El Responsable puede **excluirse** de esta contribución (opt-out) desde *Configuración → Privacidad → Opt-out analytics*. El opt-out no afecta la prestación del Servicio.

---

## 8. Derechos de los titulares (ARCO)

**8.1.** El Encargado asiste al Responsable para atender las solicitudes de los titulares en el ejercicio de sus derechos de **Acceso, Rectificación, Cancelación (supresión) y Oposición** (Ley 25.326 art. 14-16; Ley 26.529 respecto de la historia clínica):

- **Acceso y portabilidad:** la aplicación permite exportar los datos personales del profesional y de sus pacientes en formatos abiertos (CSV/JSON).
- **Rectificación:** editable desde la ficha correspondiente, preservando la trazabilidad append-only de las notas clínicas.
- **Supresión:** por pseudonimización, respetando el mínimo legal de retención (§5.1).
- **Oposición:** opt-out de analytics (§7.2).

**8.2.** Toda operación de acceso, exportación o supresión queda registrada en el audit log como evidencia de respuesta (art. 14).

**8.3.** El plazo de respuesta comprometido frente al titular es de **10 días hábiles** desde la solicitud.

---

## 9. Notificación de incidentes de seguridad (brechas)

**9.1.** Ante un incidente de seguridad que afecte datos personales, el Encargado **notificará al Responsable sin dilación indebida** una vez detectado y clasificado el incidente, con la información disponible sobre naturaleza, categorías de datos afectados, impacto probable y medidas adoptadas o propuestas.

**9.2.** El procedimiento operativo completo —detección, clasificación, plazos de notificación a la **AAIP** y a los titulares afectados, y remediación— se detalla en el documento complementario **[breach-notification-SOP.md](./breach-notification-SOP.md)**, que se considera parte integrante de este acuerdo.

**9.3.** Como Responsable, la Clínica es, en última instancia, quien decide y ejecuta las notificaciones a los titulares y a la autoridad de control que le correspondan por su rol; el Encargado colabora con la información y evidencia necesarias.

---

## 10. Auditoría y colaboración

**10.1.** El Encargado pone a disposición del Responsable la documentación necesaria para acreditar el cumplimiento de este acuerdo (descripción de medidas de seguridad, lista de subencargados, políticas vigentes).

**10.2.** El Encargado colabora razonablemente con el Responsable en las inspecciones o requerimientos de la AAIP, y en la elaboración de evaluaciones de impacto cuando resulten exigibles.

---

## 11. Vigencia y disposiciones finales

**11.1. Vigencia.** Este acuerdo rige mientras el Encargado trate datos por cuenta del Responsable, esto es, durante toda la vigencia de la suscripción al Servicio, y subsiste respecto de las obligaciones de confidencialidad, retención y supresión hasta su total cumplimiento.

**11.2. Prelación.** En caso de conflicto entre este acuerdo y los Términos y Condiciones respecto del tratamiento de datos personales, prevalece este acuerdo.

**11.3. Ley aplicable y autoridad de control.** Este acuerdo se rige por la ley de la República Argentina. La autoridad de control es la **Agencia de Acceso a la Información Pública (AAIP)** — https://www.argentina.gob.ar/aaip.

**11.4. Contacto.** Consultas de privacidad y protección de datos: **folioasistencia@gmail.com**.

---

*Documento de referencia. Folio actúa como Encargado del tratamiento; la Clínica actúa como Responsable. Ver también: [Política de Privacidad](../../app/(public)/privacidad/page.tsx), [Términos y Condiciones](../../app/(public)/terminos/page.tsx) y el SOP de notificación de brechas.*
