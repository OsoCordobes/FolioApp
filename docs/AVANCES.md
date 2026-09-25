# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** A · dirección, revisión y publicación de la exportación entregada por C. Dos subagentes trabajan en paralelo: D termina el llamador; B04 prepara la constancia de verificación de edad. La revisión independiente también acotó la ficha del paciente.

**Cómo verlo:** este archivo sigue siendo el registro vigente y su apertura en el panel lateral quedó encolada. La vista web local4420 se apagó con la interrupción; su reinicio fue rechazado por la política de ejecución. El trabajo y la evidencia quedaron conservados.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · acceso y servicios publicados | [PR175](https://github.com/OsoCordobes/FolioApp/pull/175): registro y recuperación. D · revisión A; [PR177 publicada](https://github.com/OsoCordobes/FolioApp/pull/177): servicios conservados al volver y ante respuesta perdida, [prueba Solo/Clínica](https://github.com/OsoCordobes/FolioApp/actions/runs/36088410093). |
| **Permisos de Clínica** · dos paquetes publicados | Pedidos y motivos protegidos según el rol: [PR170](https://github.com/OsoCordobes/FolioApp/pull/170). C · revisión A; [PR174 publicada](https://github.com/OsoCordobes/FolioApp/pull/174) impide entregar una firma si se revoca el acceso durante su descarga. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · publicada | Dos disposiciones, mapa confirmado, editor y enlace individual con permiso propio. D · revisión A. [Publicación verificada](https://github.com/OsoCordobes/FolioApp/pull/171) y [prueba del permiso](https://github.com/OsoCordobes/FolioApp/actions/runs/36076159519). |
| **Trabajo de recepción** · publicada | Agenda publicada con el alcance de Asistente y Coordinador. C · revisión A; [entrega](https://github.com/OsoCordobes/FolioApp/pull/172). [Prueba aprobada, sin omisiones](https://github.com/OsoCordobes/FolioApp/actions/runs/36076854795). |
| **Atención adulta** · base en construcción | B04 · revisión A; prepara registro protegido de quién comprobó la edad. No activa bloqueos ni cambia historias; criterio clínico y recorrido completo pendientes. |
| **Ficha completada por el paciente** · contrato preparado | A · [alcance preparado](B09-PATIENT-FORM-CONTRACT.md): enlace o QR, datos aportados y revisión sin sobrescribir antecedentes. Preguntas clínicas pendientes de aprobación profesional. |
| **Llamador de recepción** · base publicada; pantalla en prueba | D · revisión A; [PR179 publicada](https://github.com/OsoCordobes/FolioApp/pull/179) prepara permisos, códigos y revocación. [Pantalla y controles](https://github.com/OsoCordobes/FolioApp/pull/181): la prueba alcanzó el emparejamiento y detectó un problema móvil, ya corregido. [Ensayo de recepción en curso](https://github.com/OsoCordobes/FolioApp/actions/runs/36121490705) con sesión real verificada; corrigiendo obstáculos de la prueba antes de publicar. |
| **Google Calendar** · prueba externa pendiente | Debemos demostrar reservas reflejadas en Google, ocupación externa y cambios sin duplicados. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · descarga profesional publicada | C · revisión A; [PR182 publicada](https://github.com/OsoCordobes/FolioApp/pull/182). Historia y archivos juntos; [ensayo exacto de50MiB aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36120282745), incluidos corte de descarga y revocación. Portal del paciente e historias excepcionalmente grandes siguen pendientes. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última publicación comprobada:** [PR182 · historia y archivos en una descarga](https://github.com/OsoCordobes/FolioApp/pull/182), desde el25/09 a las11:59 (Copenhague). Para probar: Mis datos y solicitudes → Archivo clínico → Preparar o retomar entrega → Guardar historia y archivos, con cuenta autorizada y navegador compatible. Control automático posterior de master también aprobado. **Última cuota consultada:**72% disponible; reserva de cierre:15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
