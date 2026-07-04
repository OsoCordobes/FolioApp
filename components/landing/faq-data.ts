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
    q: "¿Necesito tarjeta para probar? ¿Cómo pago después?",
    a: "No hace falta tarjeta para probar: tenés 7 días con todo habilitado. Si te quedás, activás la suscripción con Mercado Pago, en pesos, mes a mes — sin contratos ni permanencia, cancelás cuando quieras desde la app.",
  },
  {
    q: "¿Cuánto tardo en dejar todo configurado?",
    a: "Unos 10 minutos. El onboarding te deja la agenda, tu página de reservas y los recordatorios andando.",
  },
  {
    q: "¿Puedo pasar mis pacientes y turnos desde Excel u otra app?",
    a: "Sí. Importás tu lista de pacientes en el onboarding y cada profesional entra con su propio acceso. Si te trabás, te damos una mano por WhatsApp.",
  },
  {
    q: "¿Sirve para clínicas con varios profesionales?",
    a: "Sí. Recepción agenda y confirma turnos de todos; cada profesional ve solo sus pacientes y sus fichas; el administrador ve la plata y el equipo. Una sola agenda, sin pisarse, sin planilla compartida.",
  },
  {
    q: "¿Cómo reciben los recordatorios mis pacientes?",
    a: "Por WhatsApp, sin que hagas nada. Al reservar les llega la confirmación, y 24 horas antes, el recordatorio, siempre que el paciente tenga WhatsApp — menos ausencias y menos llamadas.",
  },
  {
    q: "¿Se integra con mi Google Calendar?",
    a: "Sí, en los dos sentidos. Lo que agendás en Folio aparece en Google, y tus eventos de Google bloquean esos horarios para nuevas reservas.",
  },
  {
    q: "¿Qué pasa con mis datos si me voy?",
    a: "Te los llevás: los exportás en CSV desde la app cuando quieras. Las historias clínicas se conservan los 10 años que exige la Ley 26.529, como cualquier registro clínico.",
  },
];
