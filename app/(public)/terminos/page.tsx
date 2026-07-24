/**
 * Folio · Términos y Condiciones.
 *
 * Versión 2026-07-24. Incluye cláusulas de suscripción, cancelación,
 * falta de pago y reembolsos alineadas al comportamiento real del
 * producto (trial de 30 días sin tarjeta, cancelación self-service desde
 * /configuracion/billing, gate de acceso con retención de datos).
 * Bump lib/legal/versions.ts (TERMS_VERSION) ante cambios materiales.
 */

import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata = {
  title: "Términos y Condiciones",
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
        Última actualización: 24 de julio de 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Aceptación</h2>
        <p>
          Al registrar una cuenta en Folio (el &quot;Servicio&quot;) aceptás estos
          Términos y Condiciones. Si no estás de acuerdo, no uses el Servicio.
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
          <li>Sos responsable por la confidencialidad de tus credenciales.</li>
          <li>
            Declarás ser un profesional habilitado para ejercer tu rubro
            en la jurisdicción donde prestás servicios y contar con la matrícula
            correspondiente vigente.
          </li>
          <li>
            Sos responsable por el cumplimiento de la Ley 26.529 (Derechos
            del Paciente, HCE) y normativas conexas en la jurisdicción aplicable.
          </li>
          <li>
            Obtuviste el consentimiento informado del paciente antes de
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
        <h2>5. Suscripción y facturación</h2>
        <p>
          Folio se contrata por suscripción mensual. Existen dos planes:{" "}
          <b>Solo</b> (profesional independiente) y <b>Clínica</b> (equipos
          de trabajo). Los precios vigentes son los publicados en la{" "}
          <Link href="/#precios">página de precios de Folio</Link> al momento
          de la contratación o renovación de cada período.
        </p>
        <ul>
          <li>
            <b>Período de prueba:</b> toda organización nueva cuenta con{" "}
            <b>30 días de prueba sin cargo y sin necesidad de cargar ningún
            medio de pago</b>. Al finalizar la prueba, para seguir usando el
            Servicio hay que activar una suscripción.
          </li>
          <li>
            <b>Cobro:</b> mensual y por adelantado, en pesos argentinos (ARS),
            procesado mediante <b>Mercado Pago</b> (débito automático de
            suscripción). Folio no almacena los datos de tu tarjeta ni de tu
            medio de pago; los gestiona Mercado Pago.
          </li>
          <li>
            <b>Plan Clínica:</b> el precio mensual varía según la cantidad de
            miembros activos (seats) de la organización: un precio base que
            cubre al titular más un adicional por cada miembro activo
            adicional, según los valores publicados. Al sumar o dar de baja
            miembros, el monto del período siguiente se ajusta en consecuencia.
          </li>
          <li>
            <b>Cambios de precio:</b> los comunicamos con al menos 30 días de
            antelación y aplican a partir del ciclo de facturación siguiente.
            Si no estás de acuerdo, podés cancelar antes de que el nuevo precio
            entre en vigencia.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Cancelación</h2>
        <p>
          El titular (dueño) de la organización puede cancelar la suscripción
          en cualquier momento y sin expresar motivo, de forma autogestionada,
          desde <i>Configuración → Facturación</i> dentro de la aplicación. No
          hace falta llamar ni escribir a nadie.
        </p>
        <p>
          La cancelación surte efecto al <b>final del período mensual ya
          abonado</b>: no se generan cobros nuevos y el acceso completo se
          mantiene hasta esa fecha.
        </p>
        <p>Después del fin del período abonado:</p>
        <ul>
          <li>
            El acceso a la aplicación queda suspendido, pero <b>tus datos no se
            eliminan</b>: se conservan según los plazos de retención de la{" "}
            <Link href="/privacidad">Política de Privacidad</Link> (los datos
            clínicos de pacientes, 10 años — Ley 26.529 art. 18).
          </li>
          <li>
            Podés <b>reactivar</b> la suscripción cuando quieras y recuperar el
            acceso completo a tu información.
          </li>
          <li>
            Podés <b>exportar tus datos personales</b> en cualquier momento,
            incluso con la suscripción cancelada (mediante la exportación de
            datos de tu cuenta o solicitándola a{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>).
          </li>
          <li>
            Podés solicitar la <b>eliminación de tu cuenta</b>; se ejecuta a
            los 30 días, con pseudonimización de los datos clínicos que la ley
            obliga a retener (ver Política de Privacidad).
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>7. Falta de pago</h2>
        <ul>
          <li>
            Si un cobro mensual es rechazado, Mercado Pago puede reintentarlo
            según sus propias políticas. Mientras el período ya abonado siga
            vigente, tu acceso no se ve afectado.
          </li>
          <li>
            Si el período abonado vence sin que el pago se regularice, el
            acceso al Servicio se suspende. La pantalla de facturación
            permanece siempre accesible para regularizar el pago, actualizar el
            medio de pago o cancelar la suscripción.
          </li>
          <li>
            La falta de pago <b>NO elimina tus datos</b>: se conservan según
            los plazos de retención de la Política de Privacidad, y el acceso
            se restablece al regularizarse el pago.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>8. Reembolsos</h2>
        <p>
          Los importes abonados por el período en curso <b>no se
          reembolsan</b>: al cancelar, mantenés el acceso hasta el final del
          período ya pagado (ver sección 6).
        </p>
        <p>
          Excepción: si un cobro obedece a un <b>error de facturación imputable
          a Folio</b> (por ejemplo, un cobro duplicado o por un monto que no
          corresponde a tu plan), reembolsamos el importe cobrado en exceso.
          Escribinos a <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
          con el detalle del cobro y lo revisamos.
        </p>
        <p>
          Nada de esta sección limita los derechos irrenunciables que te
          correspondan como consumidor bajo la normativa argentina aplicable.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>9. Disponibilidad y soporte</h2>
        <p>
          Folio se ofrece &quot;tal cual&quot; sin garantías de disponibilidad
          ininterrumpida. El Servicio puede sufrir mantenimientos, fallas de
          terceros (Supabase, Vercel, Mercado Pago, Resend, Meta, Google) y
          limitaciones técnicas fuera de nuestro control.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>10. Limitación de responsabilidad</h2>
        <p>
          En la máxima medida permitida por ley, Folio no será responsable por
          daños indirectos, lucro cesante, pérdida de datos, ni daños mayores
          al monto pagado por vos en los últimos 12 meses por el Servicio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>11. Modificaciones</h2>
        <p>
          Podemos modificar estos términos. Te notificaremos los cambios
          relevantes con al menos 30 días de antelación. El uso continuo del
          Servicio implica aceptación de los nuevos términos.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>12. Contacto</h2>
        <p>
          Consultas: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
      </section>
    </main>
  );
}
