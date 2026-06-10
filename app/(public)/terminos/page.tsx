/**
 * Folio · Términos y Condiciones.
 *
 * Plantilla razonable para MVP. ANTES DE LANZAR PRODUCCIÓN REAL:
 * revisar con abogado especializado en datos personales + ley de
 * profesiones médicas argentina.
 */

import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/support";

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
        Última actualización: 19 de mayo de 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Aceptación</h2>
        <p>
          Al registrar una cuenta en Folio (el &quot;Servicio&quot;) usted acepta estos
          Términos y Condiciones. Si no está de acuerdo, no use el Servicio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>2. Descripción del Servicio</h2>
        <p>
          Folio es una herramienta de software como servicio (SaaS) para
          profesionales de la salud que permite gestionar turnos, agenda,
          historia clínica electrónica, pagos y comunicaciones con pacientes.
        </p>
        <p>
          El Servicio NO sustituye el juicio clínico del profesional. Folio no
          presta servicios médicos ni de salud por sí mismo.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>3. Cuenta y responsabilidades del usuario</h2>
        <ul>
          <li>Usted es responsable por la confidencialidad de sus credenciales.</li>
          <li>
            Usted declara ser un profesional habilitado para ejercer su rubro
            en la jurisdicción donde presta servicios y contar con la matrícula
            correspondiente vigente.
          </li>
          <li>
            Usted es responsable por el cumplimiento de la Ley 26.529 (Derechos
            del Paciente, HCE) y normativas conexas en la jurisdicción aplicable.
          </li>
          <li>
            Usted obtuvo el consentimiento informado del paciente antes de
            ingresar sus datos al Servicio.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>4. Tratamiento de datos personales y de salud</h2>
        <p>
          El tratamiento de datos personales se rige por nuestra{" "}
          <Link href="/privacidad">Política de Privacidad</Link> y por la Ley
          25.326 de Protección de Datos Personales (Argentina).
        </p>
        <p>
          Los datos clínicos (PHI: motivo de consulta, diagnósticos, notas SOAP,
          alergias, medicación, etc.) se almacenan cifrados con AES-256-GCM.
          Folio retiene estos datos durante el plazo legalmente exigido
          (10 años, Ley 26.529 art. 18) salvo solicitud de pseudonimización
          expresa del titular.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>5. Disponibilidad y soporte</h2>
        <p>
          Folio se ofrece &quot;tal cual&quot; sin garantías de disponibilidad
          ininterrumpida. El Servicio puede sufrir mantenimientos, fallas de
          terceros (Supabase, Vercel, Meta, Google) y limitaciones técnicas
          fuera de nuestro control.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Limitación de responsabilidad</h2>
        <p>
          En la máxima medida permitida por ley, Folio no será responsable por
          daños indirectos, lucro cesante, pérdida de datos, ni daños mayores
          al monto pagado por usted en los últimos 12 meses por el Servicio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>7. Modificaciones</h2>
        <p>
          Podemos modificar estos términos. Le notificaremos los cambios
          relevantes con al menos 30 días de antelación. El uso continuo del
          Servicio implica aceptación de los nuevos términos.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>8. Contacto</h2>
        <p>
          Consultas: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>

      <p style={{ marginTop: 48, padding: 16, background: "var(--surface-2)", borderRadius: 8, color: "var(--ink-3)", fontSize: 13 }}>
        <b>Nota MVP:</b> Este documento es una plantilla razonable. ANTES de
        lanzamiento comercial real consultar con abogado especializado en
        datos personales y normativa de profesiones de la salud argentina.
      </p>
    </main>
  );
}
