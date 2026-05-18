/**
 * Folio · /calendario
 *
 * Vista semanal de turnos + bloqueos + pedidos pendientes. Cada día tiene
 * capacity bar y indicador "Cerrado" para sáb/dom. La columna de hoy
 * (mié 13) tiene la "ahora" line a las 11:38.
 *
 * Drag-and-drop, popovers de agendar, selección múltiple para bloqueos,
 * vista Mes y vista Bandeja → F4 cuando la persistencia real entre.
 * Tooltips ricos hover → F11 (polish).
 */

import { Calendario } from "@/components/calendario/calendario";

export default function CalendarioPage() {
  return <Calendario />;
}
