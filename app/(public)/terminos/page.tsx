/**
 * Folio · Términos y Condiciones.
 *
 * Última revisión: 2026-05-21 (auditoría legal, branch
 * claude/folio-legal-compliance-audit-4JV32).
 *
 * Cambios vs. versión 2026-05-19:
 *   - Roles de tratamiento explícitos (Folio encargado / profesional responsable).
 *   - Compromiso operativo de notificación de brecha (Ley 25.326 art. 17 bis).
 *   - Suspensión y cierre de cuenta.
 *   - Cláusula de subcontratación de procesadores con notificación 30 días.
 *   - Ley aplicable y jurisdicción (Argentina, tribunales ordinarios de Córdoba).
 *
 * ANTES de lanzamiento comercial real: revisar con abogado especializado.
 */

import Link from "next/link";

export { TERMS_VERSION } from "@/lib/legal/versions";
import { TERMS_VERSION } from "@/lib/legal/versions";

export const metadata = {
  title: "Términos y Condiciones · Folio",
  description: "Términos de uso del servicio Folio para profesionales de la salud.",
};

export default function TerminosPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <Link href="/" style={{ display: "inline-block", marginBottom: 24, color: "var(--ink-3)" }}>
        ← Volver
      </Link>

      <h1 style={{ marginBottom: 8 }}>Términos y Condiciones</h1>
      <p style={{ color: "var(--ink-3)", marginBottom: 32 }}>
        Versión {TERMS_VERSION} · Última actualización: 21 de mayo de 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Aceptación</h2>
        <p>
          Al registrar una cuenta en Folio (el &quot;Servicio&quot;) usted acepta estos
          Términos y Condiciones y nuestra{" "}
          <Link href="/privacidad">Política de Privacidad</Link>. Si no está
          de acuerdo, no use el Servicio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>2. Descripción del Servicio</h2>
        <p>
          Folio es una herramienta de software como servicio (SaaS) que
          permite a profesionales de la salud habilitados gestionar turnos,
          agenda, historia clínica electrónica, pagos y comunicaciones con
          pacientes.
        </p>
        <p>
          El Servicio NO sustituye el juicio clínico del profesional y no
          presta servicios médicos ni de salud por sí mismo.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>3. Rol de las partes en el tratamiento de datos</h2>
        <p>
          Respecto de los datos de pacientes que el profesional carga en el
          Servicio:
        </p>
        <ul>
          <li>
            <b>El profesional</b> es el <b>responsable del tratamiento</b>{" "}
            (data controller) en los términos de la Ley 25.326. Define la
            finalidad y los medios del tratamiento de los datos de sus
            pacientes y mantiene las obligaciones legales y profesionales
            asociadas.
          </li>
          <li>
            <b>Folio</b> es el <b>encargado del tratamiento</b> (data
            processor) y trata los datos únicamente conforme a las
            instrucciones del profesional, a estos Términos y a la Política
            de Privacidad.
          </li>
        </ul>
        <p>
          Respecto de los datos del propio profesional (alta, facturación,
          credenciales, logs de seguridad) y de los visitantes del booking
          público, Folio actúa como responsable del tratamiento.
        </p>
        <p>
          Folio mantiene firmados los acuerdos de procesamiento (DPA) con sus
          subprocesadores listados en la Política de Privacidad. La nómina
          actualizada está disponible bajo solicitud a{" "}
          <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>4. Cuenta y responsabilidades del profesional</h2>
        <ul>
          <li>
            Usted es responsable por la confidencialidad de sus credenciales.
            Folio no responde por accesos no autorizados derivados de la
            divulgación o pérdida de las mismas.
          </li>
          <li>
            Usted declara ser un profesional habilitado para ejercer su rubro
            en la jurisdicción donde presta servicios y contar con la
            matrícula correspondiente vigente. Folio puede solicitar
            documentación que lo acredite.
          </li>
          <li>
            Usted es responsable por el cumplimiento de la Ley 26.529
            (Derechos del Paciente, HCE), la Ley 25.326 (Datos Personales) y
            la normativa profesional aplicable.
          </li>
          <li>
            Usted obtiene y conserva el <b>consentimiento informado</b> del
            paciente antes de ingresar sus datos al Servicio, incluyendo los
            consentimientos de telemedicina, divulgación científica y uso de
            fotografías cuando correspondan.
          </li>
          <li>
            Usted no usará el Servicio para almacenar datos para los cuales
            carezca de base legal, ni para fines fraudulentos, ilegales o
            contrarios a la ética profesional.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>5. Tratamiento de datos personales y de salud</h2>
        <p>
          El tratamiento se rige por la{" "}
          <Link href="/privacidad">Política de Privacidad</Link> y por la Ley
          25.326. Los datos clínicos (PHI: motivo de consulta, diagnósticos,
          notas SOAP, alergias, medicación, etc.) se almacenan cifrados con
          AES-256-GCM en la capa de aplicación, con RLS forzada y audit log
          inmutable.
        </p>
        <p>
          Folio retiene la historia clínica durante <b>10 años</b> a partir
          de la última atención (Ley 26.529 art. 18). La pseudonimización
          irreversible elimina identificadores manteniendo los datos
          clínicos huérfanos durante ese plazo.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Notificación de brechas de seguridad</h2>
        <p>
          En caso de incidente de seguridad que afecte datos personales y
          presente riesgo para los derechos del titular, Folio se compromete
          a:
        </p>
        <ul>
          <li>
            Notificar el incidente a la <b>AAIP</b> dentro de las <b>72
            horas</b> de tomado conocimiento.
          </li>
          <li>
            Notificar al profesional responsable sin dilación indebida, con
            detalle de categorías de datos comprometidos, posibles
            consecuencias y medidas adoptadas.
          </li>
          <li>
            Conservar un registro interno de incidentes y remediaciones, en
            cumplimiento del procedimiento documentado en{" "}
            <code>docs/incident-response.md</code>.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>7. Disponibilidad y soporte</h2>
        <p>
          Folio se ofrece sin garantía de disponibilidad ininterrumpida. El
          Servicio puede sufrir mantenimientos planificados, fallas de
          terceros (Supabase, Vercel, Meta, Google, Cloudflare, Mercado
          Pago, AFIP) y limitaciones técnicas fuera de nuestro control
          razonable.
        </p>
        <p>
          El soporte se brinda por correo a{" "}
          <a href="mailto:hola@folio.app">hola@folio.app</a> en horario hábil
          (lunes a viernes, 9 a 18 hs ART), con respuesta best-effort dentro
          de 1 día hábil.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>8. Precio, facturación y cancelación</h2>
        <p>
          La suscripción mensual se cobra por adelantado a través de Mercado
          Pago. El precio vigente se muestra en el panel de Configuración →
          Plan. Los cambios de precio se notifican con al menos 30 días de
          antelación.
        </p>
        <p>
          El profesional puede cancelar la suscripción en cualquier momento
          desde su panel; el cierre se hace efectivo al fin del ciclo
          facturado. No hay reembolsos por períodos parciales.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>9. Suspensión y cierre por Folio</h2>
        <p>
          Folio puede suspender o cerrar la cuenta del profesional, previa
          notificación cuando sea razonablemente posible, en los siguientes
          casos:
        </p>
        <ul>
          <li>
            Incumplimiento sustancial de estos Términos o de la Política de
            Privacidad.
          </li>
          <li>
            Falta de pago de la suscripción tras un período de gracia de 15
            días.
          </li>
          <li>
            Uso del Servicio para actividades fraudulentas, ilícitas o
            contrarias a la ética profesional.
          </li>
          <li>Resolución administrativa o judicial que así lo exija.</li>
        </ul>
        <p>
          Tras el cierre, los datos clínicos se conservan durante el plazo
          legal (10 años) accesibles a Folio en cumplimiento de su
          obligación como encargado y disponibles para entrega al profesional
          o autoridad competente. La identidad del profesional se
          pseudonimiza salvo registros contables obligatorios.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>10. Limitación de responsabilidad</h2>
        <p>
          En la máxima medida permitida por ley, Folio no será responsable
          por daños indirectos, lucro cesante, pérdida de oportunidad o
          daños mayores al monto pagado por usted en los últimos 12 meses
          por el Servicio.
        </p>
        <p>
          Esta limitación no aplica a obligaciones derivadas de dolo, culpa
          grave, ni a obligaciones legales indisponibles (incluida la
          responsabilidad de Folio como encargado bajo Ley 25.326).
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>11. Subcontratación y nuevos procesadores</h2>
        <p>
          Folio puede contratar nuevos procesadores. Los cambios sustanciales
          en la lista de procesadores (alta de uno nuevo con acceso a PHI o
          PII) se notifican al profesional con al menos <b>30 días</b> de
          antelación. Si el profesional se opone fundadamente, podrá darse
          de baja sin penalidad antes de la fecha efectiva del cambio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>12. Modificaciones</h2>
        <p>
          Podemos modificar estos Términos. Le notificaremos los cambios
          relevantes con al menos 30 días de antelación. El uso continuo del
          Servicio implica aceptación; en caso contrario el profesional puede
          ejercer su derecho a darse de baja sin penalidad.
        </p>
        <p>
          Versión vigente: <b>{TERMS_VERSION}</b>. Historial de versiones
          disponible bajo solicitud a{" "}
          <a href="mailto:hola@folio.app">hola@folio.app</a>.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>13. Ley aplicable y jurisdicción</h2>
        <p>
          Estos Términos se rigen por las leyes de la República Argentina.
          Las controversias se someterán a la jurisdicción de los tribunales
          ordinarios con asiento en la Ciudad de Córdoba, con renuncia
          expresa a cualquier otro fuero que pudiera corresponder.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>14. Contacto</h2>
        <p>
          Consultas comerciales: <a href="mailto:hola@folio.app">hola@folio.app</a>
        </p>
        <p>
          Consultas de privacidad y derechos ARCO:{" "}
          <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>
        </p>
      </section>
    </main>
  );
}
