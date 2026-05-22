/**
 * Folio · Política de Privacidad.
 *
 * Última revisión: 2026-05-21 (auditoría legal, branch claude/folio-legal-compliance-audit-4JV32).
 * Cambios vs. versión 2026-05-19:
 *   - Disclosure explícita de PostHog y Sentry (procesadores no listados antes).
 *   - Sección de cookies separada (link a /cookies).
 *   - Procedimiento de notificación de brechas (Ley 25.326 art. 17 bis).
 *   - Bases legales del tratamiento (Ley 25.326 art. 5).
 *   - Cross-border transfer disclosures (Ley 25.326 art. 12).
 *   - Procedimiento ARCO concreto (formularios + plazos).
 *   - Versión y changelog visibles (evidencia de consentimiento informado).
 *
 * ANTES de lanzamiento comercial real: revisar con abogado especializado.
 */

import Link from "next/link";

export { PRIVACY_VERSION } from "@/lib/legal/versions";
import { PRIVACY_VERSION } from "@/lib/legal/versions";

export const metadata = {
  title: "Política de Privacidad · Folio",
  description: "Cómo Folio trata datos personales y de salud bajo Ley 25.326 y Ley 26.529.",
};

export default function PrivacidadPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <Link href="/" style={{ display: "inline-block", marginBottom: 24, color: "var(--ink-3)" }}>
        ← Volver
      </Link>

      <h1 style={{ marginBottom: 8 }}>Política de Privacidad</h1>
      <p style={{ color: "var(--ink-3)", marginBottom: 32 }}>
        Versión {PRIVACY_VERSION} · Última actualización: 21 de mayo de 2026
      </p>

      <p style={{ marginBottom: 24 }}>
        Esta política describe cómo Folio trata datos personales y datos de
        salud bajo la <b>Ley 25.326</b> de Protección de Datos Personales y la{" "}
        <b>Ley 26.529</b> de Derechos del Paciente e Historia Clínica
        (República Argentina). Léala con atención antes de aceptarla.
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Quién es el responsable</h2>
        <p>
          Folio (el &quot;Servicio&quot;) opera como <b>encargado del
          tratamiento</b> (data processor) respecto de los datos de pacientes
          que el profesional carga en la plataforma. El profesional cliente del
          Servicio es el <b>responsable del tratamiento</b> (data controller)
          de los datos de sus pacientes y conserva las obligaciones legales
          derivadas de la Ley 25.326, Ley 26.529 y normativa profesional.
        </p>
        <p>
          Respecto de los datos del propio profesional (alta, facturación,
          credenciales, logs técnicos) Folio actúa como responsable del
          tratamiento.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>2. Qué datos recolectamos</h2>
        <ul>
          <li>
            <b>Datos del profesional (responsable Folio):</b> nombre, email,
            matrícula profesional, teléfono, CUIT, datos del consultorio
            (ubicación, servicios, precios), certificado AFIP cifrado.
          </li>
          <li>
            <b>Datos de pacientes (responsable: el profesional):</b>
            identificación (nombre, DNI, contacto, domicilio, fecha de
            nacimiento) y datos sensibles de salud (motivo de consulta,
            diagnósticos CIE-10, notas SOAP, alergias, medicación, sesiones
            clínicas, documentos clínicos, consentimientos firmados).
          </li>
          <li>
            <b>Datos del visitante del booking público:</b> nombre, teléfono,
            email opcional, motivo opcional, IP, user-agent. Estos datos se
            recolectan únicamente con consentimiento previo y explícito
            (checkbox de aceptación de esta política).
          </li>
          <li>
            <b>Datos técnicos:</b> IP, user-agent, logs de acceso, eventos de
            la aplicación (necesarios para seguridad, auditoría y operación).
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>3. Bases legales del tratamiento (Ley 25.326 art. 5)</h2>
        <ul>
          <li>
            <b>Consentimiento libre, expreso e informado</b> para datos
            cargados voluntariamente por el visitante del booking público y
            para datos del profesional al registrarse.
          </li>
          <li>
            <b>Ejecución de un contrato</b> entre Folio y el profesional
            (provisión del software como servicio).
          </li>
          <li>
            <b>Obligación legal del responsable</b> para datos clínicos: la
            Ley 26.529 art. 18 exige retención de la historia clínica por 10
            años, lo que prevalece sobre solicitudes de eliminación durante
            ese plazo.
          </li>
          <li>
            <b>Interés legítimo</b> para logs técnicos, prevención de fraude y
            seguridad de la plataforma, balanceado contra el derecho del
            titular.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>4. Medidas de seguridad</h2>
        <ul>
          <li>
            <b>Cifrado columnar AES-256-GCM</b> aplicado en la capa de
            aplicación sobre PII y PHI antes del INSERT en la base de datos.
            Las claves residen en variables de entorno seguras, nunca en
            código fuente ni en backups.
          </li>
          <li>
            <b>Row Level Security (RLS) forzada</b> en PostgreSQL: cada
            profesional solo puede leer datos de su propia organización; los
            asistentes administrativos no acceden a notas clínicas.
          </li>
          <li>
            <b>Audit log inmutable</b> de toda escritura sobre tablas
            sensibles (paciente, sesión, diagnóstico, alergia, medicación,
            consentimiento, documento clínico, turno, pago, member,
            organization). Retención <b>10 años</b> (Ley 26.529 art. 18).
          </li>
          <li>
            <b>Append-only</b> para notas clínicas: una vez bloqueada por el
            profesional, una sesión clínica no puede modificarse ni
            eliminarse; las correcciones se hacen mediante enmienda firmada.
          </li>
          <li>
            <b>Blind indexes</b> (HMAC-SHA256) para búsquedas sobre PII
            cifrada sin exponer el texto plano.
          </li>
          <li>
            <b>Pseudonimización</b> como mecanismo de supresión: borra
            físicamente los datos identificatorios y conserva los datos
            clínicos huérfanos durante el plazo legal de retención.
          </li>
          <li>
            <b>Backups encriptados</b> diarios con retención mínima de 30
            días.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>5. Encargados de tratamiento (procesadores)</h2>
        <p>
          Folio comparte datos con los siguientes procesadores estrictamente
          necesarios para operar el Servicio. En ningún caso vendemos sus
          datos.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 12 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th style={{ textAlign: "left", padding: 8 }}>Procesador</th>
              <th style={{ textAlign: "left", padding: 8 }}>Finalidad</th>
              <th style={{ textAlign: "left", padding: 8 }}>País</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ padding: 8 }}>Supabase</td><td style={{ padding: 8 }}>Base de datos (Postgres + Auth + Storage)</td><td style={{ padding: 8 }}>Brasil (São Paulo)</td></tr>
            <tr><td style={{ padding: 8 }}>Vercel</td><td style={{ padding: 8 }}>Hosting de la aplicación web</td><td style={{ padding: 8 }}>EE.UU. (edge global)</td></tr>
            <tr><td style={{ padding: 8 }}>Meta (WhatsApp Cloud API)</td><td style={{ padding: 8 }}>Mensajes a pacientes (solo nombre + datos del turno, nunca PHI clínica)</td><td style={{ padding: 8 }}>EE.UU.</td></tr>
            <tr><td style={{ padding: 8 }}>Google (Calendar API)</td><td style={{ padding: 8 }}>Sincronización opcional de turnos (título genérico + horario)</td><td style={{ padding: 8 }}>EE.UU.</td></tr>
            <tr><td style={{ padding: 8 }}>Cloudflare (Turnstile)</td><td style={{ padding: 8 }}>Captcha antispam en booking público y formularios</td><td style={{ padding: 8 }}>EE.UU. (edge global)</td></tr>
            <tr><td style={{ padding: 8 }}>Upstash (Redis)</td><td style={{ padding: 8 }}>Rate limiting de endpoints públicos</td><td style={{ padding: 8 }}>EE.UU. (multi-región)</td></tr>
            <tr><td style={{ padding: 8 }}>Resend</td><td style={{ padding: 8 }}>Emails transaccionales (reset de contraseña, recordatorios)</td><td style={{ padding: 8 }}>EE.UU.</td></tr>
            <tr><td style={{ padding: 8 }}>Sentry</td><td style={{ padding: 8 }}>Error tracking. URLs y request bodies son scrubbed; texto e inputs se enmascaran en client.</td><td style={{ padding: 8 }}>EE.UU.</td></tr>
            <tr><td style={{ padding: 8 }}>PostHog</td><td style={{ padding: 8 }}>Analytics de producto (eventos agregados). Session replay desactivado; propiedades personales enmascaradas; respeta Do-Not-Track.</td><td style={{ padding: 8 }}>EE.UU.</td></tr>
            <tr><td style={{ padding: 8 }}>Mercado Pago</td><td style={{ padding: 8 }}>Cobro de la suscripción mensual de Folio al profesional</td><td style={{ padding: 8 }}>Argentina / EE.UU.</td></tr>
            <tr><td style={{ padding: 8 }}>AFIP</td><td style={{ padding: 8 }}>Facturación electrónica (CAE) si el profesional la activa</td><td style={{ padding: 8 }}>Argentina</td></tr>
          </tbody>
        </table>
        <p style={{ marginTop: 12 }}>
          <b>Transferencia internacional (Ley 25.326 art. 12):</b> la
          transferencia a procesadores en EE.UU. y Brasil se realiza con
          garantías contractuales adecuadas (Data Processing Agreements y
          cláusulas modelo conforme a las Disposiciones AAIP 60/2016 y
          47/2018). El acceso de estos procesadores se limita a la finalidad
          declarada. Usted puede solicitar la lista actualizada de DPAs
          firmados escribiendo a{" "}
          <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Cookies y tecnologías similares</h2>
        <p>
          Folio usa cookies estrictamente necesarias (sesión de autenticación,
          preferencia de organización activa) y cookies de captcha
          (Cloudflare Turnstile). No usamos cookies publicitarias ni de
          rastreo cross-site. Detalles completos en nuestra{" "}
          <Link href="/cookies">Política de Cookies</Link>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>7. Analytics anonimizadas (k-anónimas)</h2>
        <p>
          Folio agrega datos de uso para mostrar comparativas anónimas a la
          comunidad de profesionales (por ejemplo, &quot;el ticket promedio
          en Quiropraxia es $25.000&quot;). Toda métrica respeta un
          k-anonimato mínimo de <b>k=5</b> (k=10 para métricas monetarias) —
          nunca se muestran datos que permitan identificar a un consultorio o
          paciente individual. El profesional puede desactivar su
          contribución desde <i>Configuración → Privacidad → Opt-out
          analytics</i>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>8. Derechos del titular (ARCO + Habeas Data)</h2>
        <p>Como titular de datos personales, usted tiene derecho a:</p>
        <ul>
          <li>
            <b>Acceso</b> (Ley 25.326 art. 14): obtener una copia legible y
            estructurada de los datos que tenemos sobre usted. El profesional
            puede ejercer este derecho directamente desde{" "}
            <i>Configuración → Privacidad → Descargar mis datos</i>{" "}
            (endpoint <code>/api/me/export</code>). Pacientes lo solicitan al
            profesional tratante o, subsidiariamente, a{" "}
            <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>.
          </li>
          <li>
            <b>Rectificación</b> (art. 16): corregir datos inexactos. El
            profesional puede editar PII no clínica desde su panel. Las notas
            clínicas bloqueadas solo se corrigen mediante enmienda firmada
            (append-only), por mandato de Ley 26.529 art. 15.
          </li>
          <li>
            <b>Supresión</b> (art. 16): para datos clínicos la supresión se
            implementa mediante <b>pseudonimización irreversible</b>
            (identidad borrada, datos clínicos huérfanos retenidos por 10
            años conforme Ley 26.529 art. 18). El profesional puede iniciar
            su propia supresión desde <i>Configuración → Eliminar cuenta</i>.
          </li>
          <li>
            <b>Oposición</b> al tratamiento para analytics (opt-out desde
            Configuración) y para comunicaciones no esenciales.
          </li>
          <li>
            <b>Portabilidad:</b> los datos exportados por <code>
              /api/me/export
            </code>{" "}
            están en formato JSON estructurado, apto para portar a otro
            proveedor.
          </li>
        </ul>
        <p>
          Folio responde dentro de los <b>10 días hábiles</b> desde la
          solicitud (Ley 25.326 art. 14). Si la respuesta requiere validar
          identidad, podremos solicitar documentación adicional. La denegación
          parcial (por ejemplo, retención obligatoria de historia clínica) se
          motiva por escrito.
        </p>
        <p>
          Si su derecho no es respetado, puede presentar una denuncia ante la{" "}
          <a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener noreferrer">
            AAIP — Agencia de Acceso a la Información Pública
          </a>
          .
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>9. Notificación de brechas de seguridad (art. 17 bis)</h2>
        <p>
          Ante un incidente de seguridad que afecte datos personales y
          presente un riesgo para los derechos del titular, Folio:
        </p>
        <ul>
          <li>
            Notifica a la <b>AAIP</b> dentro de las <b>72 horas</b> de
            tomado conocimiento del incidente.
          </li>
          <li>
            Notifica sin dilación indebida a los <b>titulares afectados</b>
            cuando el riesgo sea alto, indicando categorías de datos
            comprometidos, posibles consecuencias y medidas adoptadas.
          </li>
          <li>
            Mantiene un <b>registro interno de incidentes</b> (severidad,
            timeline, vectores, remediación) disponible para auditoría.
          </li>
        </ul>
        <p>
          El procedimiento operativo está documentado en{" "}
          <code>docs/incident-response.md</code> del repositorio del Servicio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>10. Retención de datos</h2>
        <ul>
          <li>
            <b>Datos clínicos de pacientes:</b> 10 años desde la última
            atención (Ley 26.529 art. 18). La pseudonimización elimina los
            identificadores antes de ese plazo pero conserva las anotaciones
            clínicas huérfanas.
          </li>
          <li>
            <b>Consentimientos firmados:</b> 10 años desde la firma (evidencia
            del consentimiento informado).
          </li>
          <li>
            <b>Datos del profesional:</b> mientras la cuenta esté activa.
            Tras cierre de cuenta, 60 días para reactivación; luego se
            pseudonimiza la identidad y se conservan los registros contables
            obligatorios (10 años para AFIP).
          </li>
          <li>
            <b>Audit log:</b> 10 años; las particiones más antiguas se
            archivan a almacenamiento frío mediante{" "}
            <code>audit_log_purge_expired()</code> ejecutado por cron.
          </li>
          <li>
            <b>Logs técnicos y de seguridad:</b> 90 días por defecto.
          </li>
          <li>
            <b>Datos de booking público no convertido en turno:</b> 30 días
            (eliminación automática del pedido pendiente).
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>11. Menores de edad</h2>
        <p>
          La atención de menores se rige por la Ley 26.061. El consentimiento
          es firmado por el tutor legal y se vincula al paciente menor. A
          partir de los 13 años se documenta también la opinión del menor en
          el formulario de consentimiento.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>12. Cambios a esta política</h2>
        <p>
          Si modificamos esta política se actualiza la versión visible en la
          parte superior. Las modificaciones sustanciales (nuevos
          procesadores, nuevas finalidades, cambios de retención) se
          notifican a los profesionales por email con al menos{" "}
          <b>30 días</b> de antelación. El uso continuo del Servicio luego
          de ese plazo implica aceptación; en caso contrario el profesional
          puede ejercer su derecho a darse de baja.
        </p>
        <p>
          Versión vigente: <b>{PRIVACY_VERSION}</b>. Historial de versiones
          disponible bajo solicitud.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>13. Contacto</h2>
        <p>
          Consultas y ejercicio de derechos:{" "}
          <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>
        </p>
        <p>
          Autoridad de control:{" "}
          <a href="https://www.argentina.gob.ar/aaip" target="_blank" rel="noopener noreferrer">
            AAIP — Agencia de Acceso a la Información Pública
          </a>
        </p>
      </section>
    </main>
  );
}
