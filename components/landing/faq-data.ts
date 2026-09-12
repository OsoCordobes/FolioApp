export interface FaqItem { q: string; a: string; }

/** Shared by the visible FAQ and structured data. Keep claims tied to implemented capabilities. */
export const FAQ_ITEMS: FaqItem[] = [
  { q: "¿Cómo funciona la prueba?", a: "Podés probar Folio durante 30 días sin ingresar una tarjeta. Para continuar después de la prueba, activás una suscripción mensual en pesos con Mercado Pago desde la configuración de tu cuenta." },
  { q: "¿Qué necesito para empezar?", a: "Creá tu cuenta y completá los datos de tu práctica. Folio te guía para configurar el consultorio, los horarios y los servicios, y preparar tu página de reservas." },
  { q: "¿Puedo importar mis pacientes?", a: "Sí. En Configuración tenés una herramienta para importar pacientes desde un archivo CSV. Podés revisar los datos antes de confirmar la importación." },
  { q: "¿Podemos usarlo varios profesionales?", a: "Sí. El plan Clínica permite trabajar con una agenda compartida y accesos por rol para profesionales, recepción y administración. El acceso a la información clínica depende de los permisos asignados." },
  { q: "¿Cómo se envían los recordatorios?", a: "Los recordatorios de turnos se envían por email. La confirmación de una reserva depende de la configuración del consultorio. Los recordatorios por WhatsApp no forman parte de la oferta actual." },
  { q: "¿Puedo conectar Google Calendar?", a: "Sí. Podés conectar tu calendario desde Folio para sincronizar los turnos y considerar tus eventos de Google al ofrecer horarios de reserva." },
  { q: "¿Puedo llevarme mis datos?", a: "Folio incluye exportación de datos desde la configuración y opciones de descarga en la ficha del paciente. Consultá el aviso de privacidad para conocer cómo se trata y conserva la información." },
];

