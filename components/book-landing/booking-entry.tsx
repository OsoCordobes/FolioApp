"use client";

import { createContext, useContext, useMemo, useState, type MouseEvent, type ReactNode } from "react";

interface Selection { serviceId: string; sequence: number }
interface BookingEntryValue {
  selection: Selection | null;
  blocked: boolean;
  selectService: (serviceId: string) => boolean;
  setBlocked: (blocked: boolean) => void;
}

const BookingEntryContext = createContext<BookingEntryValue | null>(null);

export function BookingEntryProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [blocked, setBlocked] = useState(false);
  const value = useMemo<BookingEntryValue>(() => ({
    selection,
    blocked,
    selectService(serviceId) {
      if (blocked) return false;
      setSelection((previous) => ({ serviceId, sequence: (previous?.sequence ?? 0) + 1 }));
      return true;
    },
    setBlocked,
  }), [selection, blocked]);
  return <BookingEntryContext.Provider value={value}>{children}</BookingEntryContext.Provider>;
}

export function useBookingEntry() {
  return useContext(BookingEntryContext);
}

export function ServiceReserveLink({ serviceId, serviceName }: { serviceId: string; serviceName: string }) {
  const entry = useBookingEntry();
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (entry && !entry.selectService(serviceId)) event.preventDefault();
  }
  return (
    <a href="#reservar" className="bl-service-cta" aria-label={`Elegir ${serviceName}`} aria-disabled={entry?.blocked || undefined} onClick={onClick}>
      Elegir <span aria-hidden="true">↗</span>
    </a>
  );
}
