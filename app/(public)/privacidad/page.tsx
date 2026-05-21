/**
 * Folio · Política de Privacidad.
 *
 * Plantilla razonable para MVP. ANTES DE LANZAR PRODUCCIÓN REAL: revisar
 * con abogado especializado en datos personales argentinos (Ley 25.326)
 * y normativa de profesiones de la salud (Ley 26.529).
 */

import Link from "next/link";

export const metadata = {
  title: "Política de Privacidad · Folio",
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
        Última actualización: 21 de mayo de 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Responsable del tratamiento</h2>
        <p>
          Folio (el &quot;Servicio&quot;) es responsable del tratamiento de sus
          datos personales bajo la Ley 25.326 de Protección de Datos Personales
          (Argentina). Si usted es un profesional cliente del Servicio, usted es
          el responsable de los datos de sus pacientes; Folio actúa como
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
          Folio NO vende sus datos. Compartimos con:
        </p>
        <ul>
          <li>
            <b>Supabase</b> (hosting de la base de datos, en São Paulo, Brasil).
            Datos cifrados in-transit (TLS) y at-rest.
          </li>
          <li>
            <b>Vercel</b> (hosting de la app web, edge global). Solo recibe
            requests, no almacena PHI persistente.
          </li>
          <li>
            <b>Meta WhatsApp</b> (mensajes a pacientes que usted autorice).
            Los mensajes contienen solo nombre y datos del turno, NUNCA PHI
            clínica.
          </li>
          <li>
            <b>Google Calendar</b> (sincronización de turnos si usted la activa).
            Folio envía solo título genérico + hora; nunca diagnóstico ni motivo.
          </li>
          <li>
            <b>Google Fonts</b> (CDN para tipografías Geist y Fraunces). El
            navegador del usuario solicita los archivos de fuente directamente
            a Google; no se envía contenido de la aplicación ni datos
            identificatorios más allá de los inherentes a cualquier request
            HTTP (IP, User-Agent).
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
          Usted puede desactivar la contribución a analytics agregados desde{" "}
          <i>Configuración → Privacidad → Opt-out analytics</i>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Derechos del titular</h2>
        <p>Como titular de datos personales, usted tiene derecho a:</p>
        <ul>
          <li>Acceder a sus datos (Ley 25.326 art. 14).</li>
          <li>Rectificar datos inexactos.</li>
          <li>
            Solicitar supresión de sus datos. En el caso de datos clínicos,
            la supresión se hace por <b>pseudonimización</b>: identidad
            removida pero datos clínicos retenidos (Ley 26.529 art. 18 exige
            10 años de retención).
          </li>
          <li>Portar sus datos a otro proveedor (en formato CSV/JSON).</li>
          <li>Oponerse al tratamiento para analytics (opt-out).</li>
        </ul>
        <p>
          Para ejercer estos derechos:{" "}
          <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>.
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
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>8. Cambios</h2>
        <p>
          Si cambiamos esta política, le avisaremos por email con al menos 30
          días de antelación.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>9. Contacto</h2>
        <p>
          Consultas de privacidad:{" "}
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
