/**
 * Folio · Landing — datos del FAQ (Fase B · B2).
 *
 * Fuente única de las preguntas frecuentes: la consume la sección
 * `components/landing/sections/faq.tsx` y el JSON-LD (FAQPage) de Fase C.
 * Solo texto plano — sin markup — para que sirva tal cual en schema.org.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "¿Necesito tarjeta para probar Folio?",
    a: "No. Tenés 7 días con todo habilitado, y recién si te convence activás la suscripción con Mercado Pago.",
  },
  {
    q: "¿Cuánto tardo en dejar todo configurado?",
    a: "Unos 10 minutos. El onboarding te guía en 9 pasos y terminás con la agenda, tu página de reservas y los recordatorios andando.",
  },
  {
    q: "¿Qué pasa con mis datos si me voy?",
    a: "Te los llevás: podés exportarlos desde la app cuando quieras. Las historias clínicas se conservan los 10 años que exige la Ley 26.529, como cualquier registro clínico.",
  },
  {
    q: "¿Sirve para clínicas con varios profesionales?",
    a: "Sí. El plan Clínica suma profesionales, asistentes y coordinación sobre una agenda compartida, cada rol con sus permisos.",
  },
  {
    q: "¿Cómo reciben los recordatorios mis pacientes?",
    a: "Por WhatsApp, sin que hagas nada. Al reservar les llega la confirmación, y 24 horas antes del turno, el recordatorio — menos ausencias, cero llamadas.",
  },
  {
    q: "¿Se integra con mi Google Calendar?",
    a: "Sí, en los dos sentidos. Lo que agendás en Folio aparece en Google, y tus eventos de Google bloquean esos horarios para nuevas reservas.",
  },
  {
    q: "¿Quién puede ver las historias clínicas?",
    a: "Solo los profesionales habilitados de tu consultorio. Cada nota se guarda cifrada en la base de datos y se descifra únicamente para mostrársela a tu equipo; cada consultorio queda aislado del resto.",
  },
  {
    q: "¿Cómo pago?",
    a: "Con Mercado Pago, en pesos, mes a mes. Sin contratos ni permanencia: cancelás cuando quieras desde la misma app.",
  },
];
