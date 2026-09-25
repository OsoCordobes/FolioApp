# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** A · dirección, revisión y publicación. C · construye la base de la entrega completa de archivos. D · investiga el ensayo de acceso y prepara el guardado seguro de servicios. Los dos subagentes trabajan en paralelo.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · corrección probada, ensayo completo en curso | Corregido un fallo que impedía guardar el avance del consultorio al volver. D · revisión A; prueba de regresión aprobada. Registro y contraseña se ensayan con cuentas y correo aislados. |
| **Permisos de Clínica** · dos paquetes publicados | Pedidos y motivos protegidos según el rol: [PR170](https://github.com/OsoCordobes/FolioApp/pull/170). C · revisión A; [PR174 publicada](https://github.com/OsoCordobes/FolioApp/pull/174) impide entregar una firma si se revoca el acceso durante su descarga. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · publicada | Dos disposiciones, mapa confirmado, editor y enlace individual con permiso propio. D · revisión A. [Publicación verificada](https://github.com/OsoCordobes/FolioApp/pull/171) y [prueba del permiso](https://github.com/OsoCordobes/FolioApp/actions/runs/36076159519). |
| **Trabajo de recepción** · publicada | Agenda publicada con el alcance de Asistente y Coordinador. C · revisión A; [entrega](https://github.com/OsoCordobes/FolioApp/pull/172). [Prueba aprobada, sin omisiones](https://github.com/OsoCordobes/FolioApp/actions/runs/36076854795). |
| **Atención adulta** · pendiente | Contrato preparado; faltan decisiones clínicas e implementación de la verificación para nuevas atenciones. |
| **Ficha completada por el paciente** · pendiente | Alcance acordado: enlace o QR, preguntas por especialidad y revisión del profesional sin sobrescribir datos. |
| **Llamador de recepción** · pendiente | Alcance acordado: código de espera y destino en pantalla; llamar no inicia la consulta. |
| **Google Calendar** · prueba externa pendiente | Debemos demostrar reservas reflejadas en Google, ocupación externa y cambios sin duplicados. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · corrección publicada | Ahora la exportación falla con aviso si un dato no puede leerse. C · revisión A; [PR173 publicada](https://github.com/OsoCordobes/FolioApp/pull/173) con sus controles aprobados. La entrega completa de archivos sigue aparte. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última publicación comprobada:** [PR174 · protección de descargas](https://github.com/OsoCordobes/FolioApp/pull/174), disponible desde el 25/09 a las 03:08 (Copenhague). Conserva la nueva miniweb, recepción, recuperación y corrección de exportación. **Última cuota consultada:** 90% disponible; reserva de cierre: 15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
