# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · publicado parcial | Ya se publicó la elección Solo/Clínica y la vuelta al inicio; siguen pendientes los recorridos completos con cuentas. A/B · [publicación PR166](https://github.com/OsoCordobes/FolioApp/pull/166). |
| **Permisos de Clínica** · paquete probado | El cambio limita los pedidos visibles y protege sus motivos clínicos; revisión independiente y controles de aplicación, base de datos y entorno de prueba aprobados. B + revisión B/A · [PR170](https://github.com/OsoCordobes/FolioApp/pull/170), [prueba de permisos](https://github.com/OsoCordobes/FolioApp/actions/runs/36069376432). Falta publicación por etapas. |
| **Recuperación completa** · ensayo integral aprobado | Se recuperaron datos cifrados, archivos privados, contraseña y segundo factor; se comprobó separación entre organizaciones. C + revisión A · [ensayo aislado aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36071187050). Datos ficticios, 120 migraciones; falta integrar el candidato y completar custodia externa. |
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

**Última versión publicada:** PR169. Los nuevos cambios anteriores aún no están en producción. **Última cuota consultada:** 96% disponible; reserva de cierre: 15%. No se atribuye consumo exacto a cada agente.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **C01, 25/09 01:10** · ensayo integral aprobado; **B05a, 25/09 00:53** · aplicación y permisos aprobados; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
