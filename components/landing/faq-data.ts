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
    a: "No. Tenés 7 días de prueba completa sin cargar ninguna tarjeta. Si te convence, recién ahí activás la suscripción con Mercado Pago.",
  },
  {
    q: "¿Qué pasa con mis datos si me voy?",
    a: "Tus datos son tuyos: podés exportarlos cuando quieras. Las historias clínicas se conservan el plazo legal de 10 años que establece la Ley 26.529, como corresponde a cualquier registro clínico.",
  },
  {
    q: "¿Sirve para clínicas con varios profesionales?",
    a: "Sí. El plan Clínica suma equipo con roles —profesionales, asistentes y coordinación— sobre una agenda compartida, cada uno con los permisos que le corresponden.",
  },
  {
    q: "¿Cómo reciben los recordatorios mis pacientes?",
    a: "Por WhatsApp. Cuando reservan les llega la confirmación del turno, y antes de la fecha reciben un recordatorio automático que ayuda a reducir ausencias.",
  },
  {
    q: "¿Se integra con mi Google Calendar?",
    a: "Sí, en ambos sentidos: lo que agendás en Folio aparece en tu Google Calendar, y tus eventos de Google bloquean la disponibilidad para nuevas reservas.",
  },
  {
    q: "¿Quién puede ver las historias clínicas?",
    a: "Solo los profesionales habilitados de tu consultorio. Las notas se cifran antes de llegar a la base de datos, y cada consultorio está aislado del resto a nivel de base de datos.",
  },
  {
    q: "¿Cómo pago?",
    a: "Con Mercado Pago: un débito mensual en pesos, sin contratos ni permanencia. Cancelás cuando quieras desde la misma app.",
  },
];
