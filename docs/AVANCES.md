# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** A · dirección, revisión y publicación. C · implementa recepción. D · prepara miniweb y sus controles. Los dos subagentes trabajan en paralelo; las tareas pendientes aún no tienen un agente asignado.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · publicado parcial | Ya se publicó la elección Solo/Clínica y la vuelta al inicio; siguen pendientes los recorridos completos con cuentas. A/B · [publicación PR166](https://github.com/OsoCordobes/FolioApp/pull/166). |
| **Permisos de Clínica** · paquete publicado | Pedidos y motivos clínicos protegidos según el rol. B · integración A y revisión C. [Publicación comprobada](https://github.com/OsoCordobes/FolioApp/pull/170); otros ámbitos de privacidad siguen pendientes. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · controles finales | Dos disposiciones, editor, mapa confirmado y enlace propio por profesional implementados; revisión móvil/escritorio aprobada. D · revisión A; [propuesta entregada](https://github.com/OsoCordobes/FolioApp/pull/171), controles finales y publicación pendientes. |
| **Trabajo de recepción** · en curso | C adapta la agenda a los permisos recién publicados: coordinación sin mostrar información clínica ni iniciar una consulta. A revisa; faltan pruebas integradas. |
| **Atención adulta** · pendiente | Contrato preparado; faltan decisiones clínicas e implementación de la verificación para nuevas atenciones. |
| **Ficha completada por el paciente** · pendiente | Alcance acordado: enlace o QR, preguntas por especialidad y revisión del profesional sin sobrescribir datos. |
| **Llamador de recepción** · pendiente | Alcance acordado: código de espera y destino en pantalla; llamar no inicia la consulta. |
| **Google Calendar** · prueba externa pendiente | Debemos demostrar reservas reflejadas en Google, ocupación externa y cambios sin duplicados. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · evidencia pendiente | Falta comprobar acceso adulto autorizado y entrega completa de datos y archivos. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última publicación comprobada:** [PR167](https://github.com/OsoCordobes/FolioApp/pull/167), ensayo de recuperación integrado; conserva los permisos publicados en PR170. La nueva miniweb sigue en revisión. **Última cuota consultada:** 94% disponible; reserva de cierre: 15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
