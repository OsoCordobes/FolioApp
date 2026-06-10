/**
 * Folio · Landing de marketing — página raíz pública (/).
 *
 * Fase A (fundación): esqueleto de 9 secciones con stubs server-only.
 * Cada componente local de acá abajo es un placeholder que los agentes
 * de Fase B reemplazan con el contenido real (header/footer viven en el
 * layout del grupo, también Fase B). Anclas de navegación estables:
 * #producto, #seguridad, #precios, #faq.
 */

function Hero() {
  return (
    <section data-fl-section="hero" className="fl-section">
      <h1 className="fl-hero-title">Tu consultorio, en orden. Vos, atendiendo.</h1>
      <a className="fi-btn fi-btn-primary" href="/onboarding">
        Empezá gratis · 7 días sin tarjeta
      </a>
    </section>
  );
}

function Producto() {
  return (
    <section id="producto" data-fl-section="producto" className="fl-section">
      <h2>Producto</h2>
    </section>
  );
}

function Features() {
  return (
    <section id="features" data-fl-section="features" className="fl-section">
      <h2>Features</h2>
    </section>
  );
}

function Showcase() {
  return (
    <section id="showcase" data-fl-section="showcase" className="fl-section">
      <h2>Showcase</h2>
    </section>
  );
}

function Testimonios() {
  return (
    <section id="testimonios" data-fl-section="testimonios" className="fl-section">
      <h2>Testimonios</h2>
    </section>
  );
}

function Seguridad() {
  return (
    <section id="seguridad" data-fl-section="seguridad" className="fl-section">
      <h2>Seguridad</h2>
    </section>
  );
}

function Precios() {
  return (
    <section id="precios" data-fl-section="precios" className="fl-section">
      <h2>Precios</h2>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" data-fl-section="faq" className="fl-section">
      <h2>Preguntas frecuentes</h2>
    </section>
  );
}

function CtaFinal() {
  return (
    <section id="cta-final" data-fl-section="cta-final" className="fl-section">
      <h2>Empezá hoy</h2>
    </section>
  );
}

export default function LandingPage() {
  return (
    <main id="contenido" className="fl-main">
      <Hero />
      <Producto />
      <Features />
      <Showcase />
      <Testimonios />
      <Seguridad />
      <Precios />
      <Faq />
      <CtaFinal />
    </main>
  );
}
