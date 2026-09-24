# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · publicado parcial | Ya se publicó la elección Solo/Clínica y la vuelta al inicio; siguen pendientes los recorridos completos con cuentas. A/B · [publicación PR166](https://github.com/OsoCordobes/FolioApp/pull/166). |
| **Permisos de Clínica** · paquete publicado | Pedidos y motivos clínicos ya respetan el alcance de cada rol; revisión independiente, controles y publicación comprobados. B + integración A/revisión C · [PR170](https://github.com/OsoCordobes/FolioApp/pull/170), [verificación final](C:/Users/amiun/Documents/Codex/folio-b05-evidence/pr170-final-readback-verified.json). La integración automática adelantó el último paso; se verificó sin repetirlo y se corrigió el procedimiento futuro. |
| **Recuperación completa** · integración en prueba | [Ensayo integral aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36071187050) con datos ficticios: información cifrada, archivos, contraseña, segundo factor y separación entre organizaciones. C/revisión A · el [ensayo sobre las dos migraciones nuevas](https://github.com/OsoCordobes/FolioApp/actions/runs/36072662112) falló al iniciar el entorno; se está diagnosticando, sin darlo por aprobado. |
| **Miniweb profesional** · diseño probado, editor en curso | Plantilla Folio con dos disposiciones revisada en teléfono y escritorio. D + revisión A · [vista de clínica](C:/Users/amiun/.codex/visualizations/2026/09/19/01a0bb0b-ad4d-7cc2-84c0-acc037b0672b/folio-d06a-review2/d06a-clinic-logo-consultorio-1440.png), [vista móvil](C:/Users/amiun/.codex/visualizations/2026/09/19/01a0bb0b-ad4d-7cc2-84c0-acc037b0672b/folio-d06a-review2/d06a-solo-perfil-375.png). En curso: guardar diseño, mapa confirmado y enlace individual revocable. |
| **Trabajo de recepción** · pendiente de integración | La agenda y llegada necesitan completar su comprobación junto con los permisos de Clínica. No se considera cerrado. |
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

**Última versión publicada:** [PR170](https://github.com/OsoCordobes/FolioApp/pull/170), permisos de Clínica. La nueva miniweb sigue en revisión. **Última cuota consultada:** 94% disponible; reserva de cierre: 15%. No se atribuye consumo exacto a cada agente.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:10** · ensayo integral anterior aprobado, nueva integración pendiente; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
