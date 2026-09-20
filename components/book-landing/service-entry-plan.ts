import { pasoTrasServicio, type BookingVista } from "@/lib/booking/wizard-profesional";

interface ServiceEntryState<TSlot> {
  serviceId: string;
  vista: BookingVista;
  slots: readonly TSlot[];
}

/** A repeated card choice leaves the current step and its loaded slots intact. */
export function planServiceEntry<TSlot>(
  current: ServiceEntryState<TSlot>,
  selectedServiceId: string,
  multiProfessional: boolean,
): ServiceEntryState<TSlot> | null {
  if (current.serviceId === selectedServiceId && current.vista !== "servicio") return null;
  return {
    serviceId: selectedServiceId,
    vista: pasoTrasServicio(multiProfessional),
    slots: [],
  };
}
