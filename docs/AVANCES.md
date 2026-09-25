# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** A · dirección, revisión y publicación. C · corrige exportación y prepara recepción para publicar. D · prepara pruebas completas de acceso y onboarding. Los dos subagentes trabajan en paralelo.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · ampliando pruebas | Solo/Clínica y vuelta al inicio publicados; D construye la prueba completa con correo y cuentas aislados. A/B · [publicación PR166](https://github.com/OsoCordobes/FolioApp/pull/166). |
| **Permisos de Clínica** · paquete publicado | Pedidos y motivos clínicos protegidos según el rol. B · integración A y revisión C. [Publicación comprobada](https://github.com/OsoCordobes/FolioApp/pull/170); otros ámbitos de privacidad siguen pendientes. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · publicada | Dos disposiciones, mapa confirmado, editor y enlace individual con permiso propio. D · revisión A. [Publicación verificada](https://github.com/OsoCordobes/FolioApp/pull/171) y [prueba del permiso](https://github.com/OsoCordobes/FolioApp/actions/runs/36076159519). |
| **Trabajo de recepción** · probado, publicación en preparación | La agenda pasó con Asistente y Coordinador en acceso y base de datos aislados. C · revisión A. [Prueba aprobada, sin omisiones](https://github.com/OsoCordobes/FolioApp/actions/runs/36076854795). |
| **Atención adulta** · pendiente | Contrato preparado; faltan decisiones clínicas e implementación de la verificación para nuevas atenciones. |
| **Ficha completada por el paciente** · pendiente | Alcance acordado: enlace o QR, preguntas por especialidad y revisión del profesional sin sobrescribir datos. |
| **Llamador de recepción** · pendiente | Alcance acordado: código de espera y destino en pantalla; llamar no inicia la consulta. |
| **Google Calendar** · prueba externa pendiente | Debemos demostrar reservas reflejadas en Google, ocupación externa y cambios sin duplicados. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · corrección probada | La entrega incompleta fue reproducida y corregida: ahora falla con aviso si un dato no puede leerse. C · revisión A y 17 controles aprobados; [publicación en preparación](https://github.com/OsoCordobes/FolioApp/pull/173). Archivos completos siguen aparte. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última publicación comprobada:** [PR171 · nueva miniweb](https://github.com/OsoCordobes/FolioApp/pull/171), disponible en foliosalud.com desde el 25/09 a las 02:25 (Copenhague). Conserva la recuperación y permisos previos. **Última cuota consultada:** 92% disponible; reserva de cierre: 15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
