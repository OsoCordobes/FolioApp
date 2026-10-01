# C05 · prueba de Google Calendar

Contrato preparado por A el 25/09/2026 a partir de la lectura independiente de C sobre master `457a6135857089b79a46481b20ea5a6e25e45c40`. No asigna un tercer escritor ni activa Google. Fijar la base final verificada al asignar.

## Resultado que necesitamos

Una reserva administrada desde Folio aparece una sola vez en un calendario controlado. Moverla, cancelarla o marcar no asistencia cambia únicamente el evento propio. Los eventos externos bloquean disponibilidad, incluyendo sus cambios y bajas. Editar un evento propio desde Google no modifica el turno Folio ni crea pacientes a partir de títulos.

## Lo que ya existe y se conserva

- M107 registra la intención de salida en la misma transacción del turno; M119 revierte las intenciones si falla la reprogramación.
- El despachador usa identificadores estables, propiedad y ETag; vuelve a consultar ante una respuesta incierta. La cola conserva reintentos, leases y errores clasificados.
- Webhook valida canal, recurso, token y vencimiento. La entrada pagina la ventana local de 30 días y aplica bloqueos por profesional, excluyendo los eventos propios.
- `google-watch-renew` está programado. `sync-google` existe pero no está en `vercel.json`; no añadirlo antes de revisar la cola y comprobar el recorrido.
- PR168 y sus pruebas focales/SQL son antecedentes, no evidencia de credenciales vigentes ni de comunicación real con Google. No repetirlos sin un cambio, fallo o duda concreta.

## Próximo paquete C05-P

**Entorno:** proyecto aislado, datos ficticios y cuenta/calendario controlados con autorización específica para crear eventos de ensayo. La organización se configura para ese ensayo; no evadir el bloqueo de `is_synthetic` en producción. No leer ni modificar eventos ajenos, enviar invitaciones ni activar las conexiones productivas existentes. Guardar únicamente identificadores de ensayo y evidencia saneada; no tokens ni contenido personal.

**Archivos propios previstos:** `scripts/testing/google-c05-proof/**` y pruebas focales del defecto que se reproduzca. Sin migraciones ni cambios a `vercel.json` en este paquete. La asignación fijará SHA base, escritor y revisión independiente.

**Aceptación:**

1. Reserva → intención → evento genérico con ID estable; cambio, cancelación y no asistencia afectan sólo al evento propio.
2. Interrupción después de insertar → consulta y reintento sin duplicar evento ni turno.
3. Evento externo ficticio → horario bloqueado; modificación y baja reconciliadas en disponibilidad.
4. Cambiar el evento Folio desde Google no modifica el turno ni crea pacientes.
5. Revocación, resultado parcial y lease vencido conservan estados recuperables y exponen error clasificado/503 donde corresponde.
6. Evidencia breve con candidato, entorno, resultado y límites; una prueba con proveedor simulado no se presenta como prueba de Google real.

## Decisión externa pendiente

Hace falta identificar y autorizar la cuenta y el calendario de ensayo. Puede prepararse el runner y ensayarlo sin tráfico externo mientras se obtiene esa decisión; la prueba externa sigue pendiente. La programación global y el tratamiento de trabajos productivos acumulados son una publicación separada, con inspección previa y aprobación concreta. No comprar servicios ni habilitar sincronización por inferencia.
