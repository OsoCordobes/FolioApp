/**
 * Folio · Landing — datos de testimonios (patrón faq-data.ts).
 *
 * REGLA INQUEBRANTABLE: solo quotes REALES de profesionales reales, con
 * permiso escrito para publicar nombre, especialidad y localidad. En un
 * producto de salud, un testimonio inventado es letal para la credibilidad
 * y legalmente riesgoso. Mientras este array esté VACÍO, la sección
 * Testimonials no se renderiza (no hay placeholder ni relleno).
 */

export interface TestimonialItem {
  /** La cita textual, sin comillas (las pone el componente). */
  quote: string;
  nombre: string;
  especialidad: string;
  localidad: string;
}

export const TESTIMONIAL_ITEMS: TestimonialItem[] = [];
