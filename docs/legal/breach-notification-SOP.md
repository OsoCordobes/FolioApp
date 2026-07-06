# SOP — Notificación de brechas de datos personales

**Procedimiento operativo estándar (Standard Operating Procedure) para la gestión de incidentes de seguridad que afecten datos personales**

**Ley 25.326 de Protección de Datos Personales (Argentina) · Ley 26.529 de Derechos del Paciente · Disposiciones de la AAIP**

> **Alcance.** Este documento define, paso a paso, cómo Folio (el **Encargado**) detecta, clasifica, remedia y notifica un incidente de seguridad que afecte datos personales o de salud (PHI/PII). Complementa el [Acuerdo de Tratamiento de Datos (DPA)](./DPA-template.md) §9. La Clínica (el **Responsable**) es, en última instancia, quien notifica a los titulares y a la autoridad de control por su rol; Folio provee detección, contención, evidencia y colaboración.
>
> **Última actualización:** 6 de julio de 2026 · **Versión:** 1.0

---

## 0. Definiciones y marco legal

**Incidente de seguridad / brecha:** todo acceso, divulgación, pérdida, alteración, sustracción o destrucción **no autorizada** de datos personales, ya sea accidental o intencional. Incluye, por ejemplo: acceso indebido a la base de datos, fuga de PHI por un bug de RLS o de cifrado, exposición de claves/credenciales, ransomware, o exfiltración vía un subencargado.

**Marco legal aplicable:**

- **Ley 25.326, art. 9** — el responsable/encargado debe adoptar medidas técnicas y organizativas para garantizar la seguridad de los datos y evitar su adulteración, pérdida, consulta o tratamiento no autorizado.
- **Ley 25.326, art. 28** — atribuciones y facultades de control de la **Agencia de Acceso a la Información Pública (AAIP)**, autoridad ante la cual se canalizan los reportes y requerimientos vinculados a incidentes.
- **Disposiciones de la AAIP** en materia de medidas de seguridad y de notificación de incidentes — fijan el deber de reportar los incidentes de seguridad relevantes a la autoridad y, cuando corresponda, a los titulares afectados, **sin dilación indebida** tras su detección.
- **Ley 26.529** — obligaciones reforzadas de confidencialidad e integridad sobre la historia clínica (PHI).

> **Nota.** Los plazos exactos y el formato del reporte a la AAIP siguen la Disposición vigente al momento del incidente. Este SOP fija plazos internos **conservadores** (§4) para llegar en tiempo a cualquier obligación regulatoria; ante actualización de la normativa, se ajustan estos plazos.

---

## 1. Roles y responsabilidades

| Rol | Responsabilidad |
|---|---|
| **Punto de contacto de incidentes (Folio)** | Recibe la alerta, abre el caso, coordina las fases. Contacto: **folioasistencia@gmail.com**. |
| **Encargado (Folio)** | Detecta, contiene, investiga, remedia, preserva evidencia y **notifica al Responsable**. Colabora con la AAIP. |
| **Responsable (Clínica)** | Decide y ejecuta la notificación a los **titulares** (pacientes) y, según su rol, a la **AAIP**, con el apoyo de Folio. |
| **AAIP** | Autoridad de control (Ley 25.326 art. 28). https://www.argentina.gob.ar/aaip |

---

## 2. Fase 1 — Detección

**2.1. Fuentes de detección.**

- Alertas de **Sentry** (errores anómalos, picos de excepciones de desencriptación o de acceso).
- Anomalías en el **audit log** inmutable (accesos fuera de patrón, lecturas masivas, operaciones cross-tenant inesperadas).
- Chequeos de salud (`/api/health`) y monitoreo de infraestructura (Supabase, Vercel).
- Reporte de un subencargado (§6.1 del DPA), de un usuario, de un investigador de seguridad o de la propia AAIP.

**2.2. Registro inicial.** Ante cualquier señal, el Punto de contacto **abre un caso** con: fecha/hora de detección, fuente, descripción preliminar, sistemas involucrados y quién reporta. Se inicia una **bitácora cronológica** del incidente (toda acción, con timestamp), que servirá luego como evidencia.

**2.3. Preservación de evidencia.** Antes de remediar, se preservan logs, audit trail, snapshots de estado y cualquier artefacto relevante. **No** se destruye ni sobrescribe evidencia; recordar que el audit log y las notas clínicas son **append-only** por diseño.

---

## 3. Fase 2 — Clasificación

**3.1. Contención inmediata.** En paralelo a la clasificación, se ejecutan medidas de contención para detener la brecha en curso: revocar credenciales/sesiones comprometidas, rotar claves, cerrar el vector de acceso, aislar el componente afectado.

**3.2. Evaluación de alcance y severidad.** Se determina:

- **Qué datos** se vieron afectados: ¿PHI clínica, PII identificatoria, datos de facturación, solo datos técnicos?
- **Cuántos titulares** y **cuántas organizaciones** (tenants) están involucrados.
- **Estado de cifrado:** ¿los datos expuestos estaban cifrados app-side (AES-256-GCM)? Una exposición de **ciphertext sin la clave** reduce drásticamente el riesgo frente a una exposición de datos en claro.
- **Confidencialidad, integridad, disponibilidad:** ¿hubo lectura, alteración o pérdida?

**3.3. Matriz de severidad.**

| Nivel | Criterio | Ejemplo |
|---|---|---|
| **Crítico** | PHI o PII en claro expuesta/exfiltrada, o pérdida irreversible de datos clínicos, o afectación de múltiples tenants | Fuga de historia clínica en claro; borrado sin backup |
| **Alto** | PII expuesta, o PHI expuesta solo como ciphertext sin clave, afectación acotada | Bug de RLS que permitió leer PII de otra org |
| **Medio** | Datos técnicos/metadatos sensibles, sin PHI/PII de titulares | Exposición de logs con IPs |
| **Bajo** | Intento sin éxito, o exposición de datos no personales | Escaneo bloqueado; secreto rotado preventivamente |

**3.4. Umbral de notificación.** Los incidentes de nivel **Crítico** y **Alto** disparan el deber de notificación (§4-§5). Los de nivel **Medio/Bajo** se documentan y se evalúan; pueden no requerir notificación externa, pero **sí** registro interno y, si corresponde, aviso al Responsable.

---

## 4. Fase 3 — Notificación (plazos)

Los plazos se cuentan **desde la detección** del incidente (fase 1) y son plazos **internos conservadores** para cumplir con la obligación legal de notificar **sin dilación indebida** (Disposiciones AAIP, Ley 25.326 art. 28).

| T (desde la detección) | Acción | Destinatario |
|---|---|---|
| **≤ 24 h** | Notificación **preliminar al Responsable** (Clínica): qué pasó, qué datos, alcance estimado, medidas de contención en curso. | Responsable (Clínica) |
| **≤ 72 h** | Reporte formal preparado para la **AAIP** (incidentes Crítico/Alto): naturaleza del incidente, categorías y volumen aproximado de datos y titulares afectados, consecuencias probables, medidas adoptadas y por adoptar, y datos del punto de contacto. | AAIP (con/por cuenta del Responsable según su rol) |
| **Sin dilación tras confirmar afectación** | Notificación a los **titulares afectados** cuando el incidente entrañe un **alto riesgo** para sus derechos (p. ej. PHI/PII en claro): descripción clara del incidente, datos afectados, recomendaciones para mitigar el impacto y canal de contacto. | Titulares (pacientes), a través del / con apoyo del Responsable |

**4.1. Contenido mínimo de toda notificación** (Disposiciones AAIP):

1. Naturaleza del incidente y fecha/hora aproximada de ocurrencia y de detección.
2. Categorías y volumen aproximado de datos personales y de titulares afectados.
3. Consecuencias probables del incidente.
4. Medidas adoptadas o propuestas para remediar y mitigar.
5. Punto de contacto para más información (**folioasistencia@gmail.com**).

**4.2. Reparto de deberes Encargado/Responsable.** Folio **siempre** notifica al Responsable (≤24 h) y le entrega el reporte técnico y la evidencia. La notificación a la **AAIP** y a los **titulares** corresponde primariamente al **Responsable** (que mantiene la relación con el paciente); Folio la ejecuta o la asiste según lo pactado en el DPA §9 y según el rol de cada parte.

---

## 5. Fase 4 — Remediación y cierre

**5.1. Erradicación.** Corregir la causa raíz (fix de código, política de RLS, rotación definitiva de claves/credenciales, parche de dependencia, endurecimiento de configuración).

**5.2. Recuperación.** Restaurar desde backups cifrados si hubo pérdida o alteración; verificar integridad de los datos restaurados; confirmar que la brecha está efectivamente cerrada.

**5.3. Verificación.** Monitoreo reforzado post-incidente para confirmar que no persiste actividad anómala.

**5.4. Post-mortem (lecciones aprendidas).** Documento sin PHI que describe: línea de tiempo, causa raíz, impacto real, qué funcionó y qué no, y **acciones correctivas** con responsables y fechas (p. ej. nuevo test de RLS/pgtap, alerta adicional en Sentry, hardening de rate-limit).

**5.5. Cierre.** El caso se cierra cuando: (a) la causa raíz está remediada, (b) las notificaciones exigibles fueron cursadas, (c) el post-mortem está documentado y (d) las acciones correctivas quedaron agendadas. La bitácora del incidente se conserva como evidencia junto al audit log.

---

## 6. Registro y conservación

- Todo incidente —independientemente de su severidad— se **registra** en un inventario interno de incidentes con: fecha, severidad, datos afectados, notificaciones cursadas y estado.
- La bitácora, la evidencia y el post-mortem se **conservan** por un plazo alineado con la retención del audit log (Ley 26.529 / Ley 25.326), a fin de acreditar el cumplimiento ante la AAIP.

---

## 7. Checklist rápido de respuesta

- [ ] **Detectar** y abrir caso; iniciar bitácora cronológica.
- [ ] **Preservar** evidencia (logs, audit trail, snapshots) antes de tocar nada.
- [ ] **Contener** (revocar sesiones/credenciales, rotar claves, cerrar el vector).
- [ ] **Clasificar** alcance, datos afectados, estado de cifrado y severidad.
- [ ] **Notificar al Responsable ≤ 24 h.**
- [ ] Si Crítico/Alto: **preparar reporte a la AAIP ≤ 72 h** (art. 28 / Disposiciones AAIP).
- [ ] Si alto riesgo para titulares: **notificar a los pacientes afectados sin dilación** (vía/apoyo del Responsable).
- [ ] **Remediar** causa raíz y **recuperar** desde backups si hubo pérdida.
- [ ] **Post-mortem** + acciones correctivas agendadas.
- [ ] **Registrar y conservar** el incidente y la evidencia.

---

*Documento de referencia interno. Complementa el [DPA](./DPA-template.md). Autoridad de control: AAIP (https://www.argentina.gob.ar/aaip). Contacto de incidentes: folioasistencia@gmail.com.*
