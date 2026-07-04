/**
 * Folio · Política de Privacidad.
 *
 * Versión 2026-07-04. §4 lista TODOS los encargados de tratamiento reales
 * (Supabase, Vercel, Mercado Pago, Resend, Sentry, PostHog, Meta, Google)
 * con su finalidad — Ley 25.326. Los datos se alojan en São Paulo, Brasil
 * (región sa-east-1, Sudamérica). Bump lib/legal/versions.ts
 * (PRIVACY_VERSION) ante cambios materiales.
 */

import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata = {
  title: "Política de Privacidad",
  description: "Cómo Folio trata datos personales y de salud.",
};

export default function PrivacidadPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <Link href="/" style={{ display: "inline-block", marginBottom: 24, color: "var(--ink-3)" }}>
        ← Volver
      </Link>

      <h1 style={{ marginBottom: 8 }}>Política de Privacidad</h1>
      <p style={{ color: "var(--ink-3)", marginBottom: 32 }}>
        Última actualización: 4 de julio de 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Responsable del tratamiento</h2>
        <p>
          Folio (el &quot;Servicio&quot;) es responsable del tratamiento de tus
          datos personales bajo la Ley 25.326 de Protección de Datos Personales
          (Argentina). Si sos un profesional cliente del Servicio, vos sos el
          responsable de los datos de tus pacientes; Folio actúa como
          encargado del tratamiento (data processor).
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>2. Qué datos recolectamos</h2>
        <ul>
          <li>
            <b>Datos del profesional:</b> nombre, email, matrícula profesional,
            teléfono, datos del consultorio (ubicación, servicios, precios).
          </li>
          <li>
            <b>Datos de pacientes</b> (ingresados por el profesional):
            identificación (nombre, DNI, contacto, domicilio) y datos de salud
            (motivo de consulta, diagnósticos, notas clínicas, alergias,
            medicación, vértebras ajustadas, etc.).
          </li>
          <li>
            <b>Datos de facturación de la suscripción:</b> plan contratado,
            estado de los cobros y email del pagador. Los datos del medio de
            pago (tarjeta, cuenta) los gestiona Mercado Pago; Folio nunca los
            ve ni los almacena.
          </li>
          <li>
            <b>Datos técnicos:</b> logs de acceso, IP, navegador, eventos de la
            aplicación (necesarios para seguridad y auditoría).
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>3. Cómo protegemos los datos</h2>
        <ul>
          <li>
            <b>Cifrado columnar AES-256-GCM</b> app-side para PII y PHI antes
            de ingresar a la base de datos. Las claves viven en variables de
            entorno seguras, nunca en código.
          </li>
          <li>
            <b>RLS (Row Level Security)</b> en PostgreSQL: cada profesional
            solo puede leer los datos de su organización; los asistentes no
            tienen acceso a PHI clínica.
          </li>
          <li>
            <b>Audit log inmutable</b> de toda lectura/escritura sobre tablas
            sensibles. Retención 10 años (Ley 26.529 art. 18).
          </li>
          <li>
            <b>Append-only</b> para notas clínicas: las correcciones se hacen
            por enmienda firmada digitalmente, nunca por UPDATE.
          </li>
          <li>Backups encriptados con retención mínima de 30 días.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>4. Con quién compartimos los datos</h2>
        <p>
          Folio NO vende tus datos. Para prestar el Servicio utilizamos los
          siguientes encargados de tratamiento (procesadores), cada uno
          limitado a su finalidad:
        </p>
        <ul>
          <li>
            <b>Supabase</b> (hosting de la base de datos, en São Paulo, Brasil
            — región Sudamérica). Datos cifrados in-transit (TLS) y at-rest.
          </li>
          <li>
            <b>Vercel</b> (hosting de la app web, edge global). Solo recibe
            requests, no almacena PHI persistente.
          </li>
          <li>
            <b>Mercado Pago</b> (procesamiento de los pagos de la suscripción).
            Recibe los datos del pagador (nombre, email, medio de pago) para
            gestionar el débito automático mensual. <b>Jamás</b> recibe datos
            clínicos ni datos de pacientes.
          </li>
          <li>
            <b>Resend</b> (envío de emails transaccionales: confirmaciones y
            recordatorios de turno, invitaciones de equipo, avisos de
            facturación). Recibe únicamente el nombre y la dirección de email
            del destinatario y el contenido del aviso; nunca PHI clínica.
          </li>
          <li>
            <b>Sentry</b> (monitoreo de errores de la aplicación). Los reportes
            de error se depuran antes de enviarse (scrubbing automático de
            datos de request) para que no incluyan PHI ni datos sensibles.
          </li>
          <li>
            <b>PostHog</b> (analytics de producto). Solo se activa si aceptás
            analytics en el aviso de cookies (opt-in); registra eventos de uso
            de la aplicación sin PHI ni datos de pacientes. Ver la{" "}
            <Link href="/cookies">Política de Cookies</Link>.
          </li>
          <li>
            <b>Meta WhatsApp</b> (mensajes a pacientes que vos autorices).
            Los mensajes contienen solo nombre y datos del turno, NUNCA PHI
            clínica.
          </li>
          <li>
            <b>Google Calendar</b> (sincronización de turnos si la activás).
            Folio envía solo título genérico + hora; nunca diagnóstico ni motivo.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>5. Analytics anonimizadas (k-anónimas)</h2>
        <p>
          Folio agrega datos de uso para mostrar comparativas anónimas a la
          comunidad de profesionales (ej. &quot;el ticket promedio en
          Quiropraxia es $25.000&quot;). Toda métrica respeta k-anonimato
          mínimo de 5 (k≥5, k≥10 para precios) — nunca se muestran datos que
          permitan identificar a un consultorio o paciente individual.
        </p>
        <p>
          Podés desactivar la contribución a analytics agregados desde{" "}
          <i>Configuración → Privacidad → Opt-out analytics</i>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Derechos del titular</h2>
        <p>Como titular de datos personales, tenés derecho a:</p>
        <ul>
          <li>Acceder a tus datos (Ley 25.326 art. 14).</li>
          <li>Rectificar datos inexactos.</li>
          <li>
            Solicitar supresión de tus datos. En el caso de datos clínicos,
            la supresión se hace por <b>pseudonimización</b>: identidad
            removida pero datos clínicos retenidos (Ley 26.529 art. 18 exige
            10 años de retención).
          </li>
          <li>Portar tus datos a otro proveedor (en formato CSV/JSON).</li>
          <li>Oponerte al tratamiento para analytics (opt-out).</li>
        </ul>
        <p>
          Para ejercer estos derechos:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          Respondemos dentro de 10 días hábiles.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>7. Retención</h2>
        <ul>
          <li>
            <b>Datos clínicos de pacientes:</b> 10 años desde la última
            atención (Ley 26.529 art. 18).
          </li>
          <li>
            <b>Datos del profesional:</b> mientras la cuenta esté activa. Tras
            cierre de cuenta, 60 días para reactivación, luego eliminación
            (excepto registros contables/fiscales obligatorios).
          </li>
          <li>
            <b>Logs técnicos:</b> 90 días por defecto, 7 años para audit log
            (Ley 25.326).
          </li>
        </ul>
        <p>
          La cancelación de la suscripción o la falta de pago NO eliminan tus
          datos: se conservan según estos mismos plazos y podés recuperar el
          acceso reactivando la suscripción (ver{" "}
          <Link href="/terminos">Términos y Condiciones</Link>, secciones 6 y 7).
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>8. Cambios</h2>
        <p>
          Si cambiamos esta política, te avisaremos por email con al menos 30
          días de antelación.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>9. Contacto</h2>
        <p>
          Consultas de privacidad:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
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
