"use client";

import { useEffect, useRef } from "react";

/** Keep keyboard position when a disclosure replaces its own trigger.
 * Does not move focus on mount, or while another control still has it. */
export function useDisclosureFocus(open: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousOpen = useRef(open);

  useEffect(() => {
    const changed = previousOpen.current !== open;
    previousOpen.current = open;
    if (!changed || document.activeElement !== document.body) return;
    const selector = open
      ? 'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
      : 'button:not(:disabled)';
    // Native focus also exposes the control, respecting the document's mobile
    // navigation scroll padding without requesting animated scrolling.
    containerRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [open]);

  return containerRef;
}
