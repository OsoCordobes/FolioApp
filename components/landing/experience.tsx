import Link from "next/link";
import { Calendar, Check, ChevronDown, Lock, Users, Wallet, Stethoscope } from "@/components/icons";
import { ProductPreview } from "@/components/landing/product-preview";
import { FAQ_ITEMS } from "@/components/landing/faq-data";
import { MP_PLAN_PRICE_CENTS } from "@/lib/mercadopago/client";
import { resolveClinicBasePriceCents, resolveClinicSeatPriceCents } from "@/lib/billing/pricing";
import { formatArsFromCents } from "@/lib/format/currency";

const SPECIALTIES = [
  { name: "Psicología", text: "Sesiones, escalas y seguimiento del proceso terapéutico." },
  { name: "Cardiología", text: "Registro cardiovascular, factores de riesgo y estudios." },
  { name: "Kinesiología", text: "Dolor, evaluaciones funcionales y evolución entre sesiones." },
  { name: "Nutrición", text: "Mediciones, evolución antropométrica y plan alimentario." },
  { name: "Quiropraxia", text: "Registro por segmento, notas de atención y estudios adjuntos." },
];

export function FolioExperience() {
  return <>
    <section className="fx-hero" data-fl-section="hero" aria-labelledby="fx-hero-title">
      <div className="fx-hero-inner">
        <div className="fx-hero-copy">
          <p className="fx-audience"><span aria-hidden="true" /> Para quienes cuidan de otros</p>
          <h1 id="fx-hero-title">Tu consultorio.<br />Todo a mano.</h1>
          <p className="fx-hero-description">La agenda, la historia de cada paciente y los cobros. Un mismo lugar para organizar tu práctica y seguir cada consulta.</p>
          <div className="fx-hero-actions"><Link href="/onboarding" className="fi-btn fi-btn-primary fx-button" data-fl-cta="hero">Crear mi consultorio</Link><a href="#producto" className="fx-text-link" data-fl-cta="hero">Recorrer Folio <ChevronDown size={16} aria-hidden="true" /></a></div>
          <p className="fx-trial-note">30 días de prueba. Sin tarjeta.</p>
          <div className="fx-origin"><Stethoscope size={21} aria-hidden="true" /><p>Para profesionales y equipos de salud<br />en Argentina.</p></div>
        </div>
        <ProductPreview compact />
      </div>
      <div className="fx-hero-baseline"><span>El trabajo del consultorio, conectado.</span><span>Turnos <i aria-hidden="true" /> Pacientes <i aria-hidden="true" /> Historia clínica <i aria-hidden="true" /> Cobros</span></div>
    </section>

    <section id="producto" className="fx-section fx-tour" data-fl-section="product" aria-labelledby="fx-tour-title">
      <div className="fx-section-heading"><h2 id="fx-tour-title">El día avanza.<br />La información te acompaña.</h2><p>Del primer turno al último cobro, el contexto del paciente sigue con vos. Recorré las tres vistas.</p></div>
      <ProductPreview />
    </section>

    <section id="dia" className="fx-workflow" data-fl-section="day" aria-labelledby="fx-workflow-title">
      <div className="fx-section fx-workflow-inner"><div className="fx-workflow-intro"><span className="fx-section-label">Un día en tu consultorio</span><h2 id="fx-workflow-title">Menos saltos.<br />Más continuidad.</h2><p>La atención tiene un recorrido. Tu herramienta también.</p><Link className="fx-text-link" href="/onboarding">Preparar mi consultorio</Link></div>
      <ol className="fx-workflow-list">
        <li><span className="fx-step-number">1</span><div><h3>Organizá la llegada</h3><p>Agendá un turno, recibí reservas online y marcá quién ya está en la sala de espera.</p><span className="fx-workflow-detail"><Calendar size={15} /> Agenda y reservas</span></div></li>
        <li><span className="fx-step-number">2</span><div><h3>Atendé con el contexto a mano</h3><p>Consultá antecedentes y notas anteriores. Registrá la atención en la ficha del paciente.</p><span className="fx-workflow-detail"><Stethoscope size={15} aria-hidden="true" /> Historia clínica por especialidad</span></div></li>
        <li><span className="fx-step-number">3</span><div><h3>Cerrá la consulta, seguí la historia</h3><p>Registrá el cobro o el saldo pendiente. La información queda disponible para el próximo encuentro.</p><span className="fx-workflow-detail"><Wallet size={15} aria-hidden="true" /> Cobros y seguimiento</span></div></li>
      </ol></div>
    </section>

    <section id="ficha" className="fx-section fx-specialties" data-fl-section="specialties" aria-labelledby="fx-specialty-title">
      <div className="fx-section-heading"><h2 id="fx-specialty-title">Tu práctica tiene<br />su propia forma.</h2><p>Una base común para el consultorio. Herramientas de registro que acompañan el trabajo de cada especialidad.</p></div>
      <div className="fx-specialty-layout"><div className="fx-file-illustration" aria-hidden="true"><div className="fx-file-tab">Historia clínica</div><div className="fx-file-sheet"><span className="fx-file-brand">folio.</span><div className="fx-file-patient"><span>MR</span><div><strong>Martina Ríos</strong><small>Paciente de ejemplo</small></div></div><div className="fx-file-section"><b>Una historia, a lo largo del tiempo.</b><span>Antecedentes</span><span>Consultas y evolución</span><span>Estudios y documentos</span></div><div className="fx-file-sign"><Lock size={15} aria-hidden="true" /> Acceso según permisos</div></div><div className="fx-file-caption">Cada consulta suma contexto.</div></div>
      <div className="fx-specialty-list">{SPECIALTIES.map((item, index) => <details key={item.name} open={index === 0}><summary>{item.name}<ChevronDown size={18} aria-hidden="true" /></summary><p>{item.text}</p></details>)}<p className="fx-specialty-note">Herramientas de registro para acompañar tu criterio profesional.</p></div></div>
    </section>

    <section className="fx-connected" aria-labelledby="fx-connected-title"><div className="fx-section"><div className="fx-section-heading"><h2 id="fx-connected-title">También fuera<br />de la consulta.</h2><p>Tu equipo y tus pacientes necesitan información clara, cada uno desde su lugar.</p></div><div className="fx-connected-grid">
      <article><span className="fx-function-icon"><Calendar size={22} /></span><h3>Tu página de reservas</h3><p>Compartí un enlace con tus servicios y horarios disponibles. Recibí solicitudes desde tu página.</p><span>Recordatorios por email</span></article>
      <article><span className="fx-function-icon"><Users size={22} aria-hidden="true" /></span><h3>Un equipo organizado</h3><p>Agenda compartida y accesos por rol para coordinar profesionales, administración y recepción.</p><span>Permisos según la función</span></article>
      <article><span className="fx-function-icon"><Check size={22} aria-hidden="true" /></span><h3>Un lugar para tus pacientes</h3><p>Un portal para consultar turnos, revisar el resumen disponible y gestionar sus datos y consentimientos.</p><Link href="/portal/login">Ingresar al portal</Link></article>
    </div></div></section>

    <section id="seguridad" className="fx-section fx-privacy" data-fl-section="security"><div className="fx-privacy-mark" aria-hidden="true"><Lock size={32} aria-hidden="true" /></div><div><h2>La información clínica merece cuidado.</h2><p>Folio incorpora cifrado de información clínica, permisos de acceso por rol y registros de actividad. Son parte del trabajo cotidiano de tu consultorio.</p><Link href="/privacidad" className="fx-text-link">Cómo tratamos los datos</Link></div></section>

    <section id="precios" className="fx-section fx-pricing" data-fl-section="pricing" aria-labelledby="fx-pricing-title"><div className="fx-section-heading"><h2 id="fx-pricing-title">Un plan para<br />tu forma de trabajar.</h2><p>Probá Folio durante 30 días, sin tarjeta. Después, suscripción mensual en pesos con Mercado Pago.</p></div>
      <div className="fx-price-grid"><article className="fx-price-card"><div className="fx-plan-heading"><span>Tu práctica independiente</span><h3>Solo</h3></div><p className="fx-price"><strong>{formatArsFromCents(MP_PLAN_PRICE_CENTS)}</strong><span>ARS / mes</span></p><p>Un profesional, todas las herramientas del consultorio.</p><Link href="/onboarding" className="fi-btn fi-btn-primary fx-button" data-fl-cta="pricing_solo">Empezar mi prueba</Link><ul>{["Agenda y reservas online", "Pacientes e historia clínica cifrada", "Registro de cobros y finanzas", "Portal del paciente", "Conexión con Google Calendar"].map((text) => <li key={text}><Check size={16} aria-hidden="true" />{text}</li>)}</ul></article>
      <article className="fx-price-card fx-price-card--team"><div className="fx-plan-heading"><span>Para trabajar en equipo</span><h3>Clínica</h3></div><p className="fx-price"><strong>{formatArsFromCents(resolveClinicBasePriceCents())}</strong><span>ARS / mes</span></p><p>Incluye al titular. Cada profesional adicional: {formatArsFromCents(resolveClinicSeatPriceCents())} ARS / mes.</p><Link href="/onboarding" className="fi-btn fi-btn-secondary fx-button" data-fl-cta="pricing_clinic">Crear mi clínica</Link><ul>{["Todas las herramientas del plan Solo", "Agenda compartida del equipo", "Roles para administrar y recibir pacientes", "Permisos de acceso clínico"].map((text) => <li key={text}><Check size={16} aria-hidden="true" />{text}</li>)}</ul></article></div>
    </section>

    <section id="faq" className="fx-section fx-faq" data-fl-section="faq" aria-labelledby="fx-faq-title"><div><h2 id="fx-faq-title">Antes de empezar.</h2><p>Algunas respuestas útiles para conocer Folio.</p></div><div className="fx-faq-list">{FAQ_ITEMS.map((item, index) => <details key={item.q} data-fl-faq={index}><summary>{item.q}<ChevronDown size={18} aria-hidden="true" /></summary><p>{item.a}</p></details>)}</div></section>

    <section className="fx-closing" data-fl-section="cta"><div><span className="fx-closing-mark" aria-hidden="true">f.</span><h2>Hacé lugar<br />para tu práctica.</h2><p>Empezá por tu consultorio. Después, tu próximo paciente.</p><Link className="fi-btn fi-btn-primary fx-button" href="/onboarding" data-fl-cta="final">Crear mi consultorio</Link><span className="fx-trial-note">30 días de prueba. Sin tarjeta.</span></div></section>
  </>;
}
