# Folio · avances comprobables

Actualizado: 25/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** A dirige, revisa e integra. Dos agentes implementan en copias aisladas: ficha del paciente y protección ante permisos revocados durante una operación. Un tercer agente revisa la seguridad de la ficha. El aviso móvil ya pasó revisión visual y espera los controles de publicación.

**Cómo verlo:** este archivo sigue siendo el registro vigente y su apertura en el panel lateral quedó encolada. La vista web local4420 se apagó con la interrupción; su reinicio fue rechazado por la política de ejecución. El trabajo y la evidencia quedaron conservados.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Ingreso y onboarding** · acceso y servicios publicados | [PR175](https://github.com/OsoCordobes/FolioApp/pull/175): registro y recuperación. D · revisión A; [PR177 publicada](https://github.com/OsoCordobes/FolioApp/pull/177): servicios conservados al volver y ante respuesta perdida, [prueba Solo/Clínica](https://github.com/OsoCordobes/FolioApp/actions/runs/36088410093). |
| **Permisos de Clínica** · dos paquetes publicados | Pedidos y motivos protegidos según el rol: [PR170](https://github.com/OsoCordobes/FolioApp/pull/170). C · revisión A; [PR174 publicada](https://github.com/OsoCordobes/FolioApp/pull/174) impide entregar una firma si se revoca el acceso durante su descarga. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · publicada | Dos disposiciones, mapa confirmado, editor y enlace individual con permiso propio. D · revisión A. [Publicación verificada](https://github.com/OsoCordobes/FolioApp/pull/171) y [prueba del permiso](https://github.com/OsoCordobes/FolioApp/actions/runs/36076159519). |
| **Trabajo de recepción** · publicada | Agenda publicada con el alcance de Asistente y Coordinador. C · revisión A; [entrega](https://github.com/OsoCordobes/FolioApp/pull/172). [Prueba aprobada, sin omisiones](https://github.com/OsoCordobes/FolioApp/actions/runs/36076854795). |
| **Atención adulta** · base publicada; refuerzo en curso | [PR183 publicada](https://github.com/OsoCordobes/FolioApp/pull/183), con [pruebas aprobadas](https://github.com/OsoCordobes/FolioApp/actions/runs/36125833441). B04-R investiga y corrige un caso adicional de permiso revocado durante la operación. Interfaz y criterio profesional pendientes; no activa bloqueos clínicos. |
| **Ficha completada por el paciente** · en curso | Agente B09 · [alcance acordado](B09-PATIENT-FORM-CONTRACT.md): enlace revocable y datos aportados protegidos, sin sobrescribir antecedentes. Primero la base y después el formulario; preguntas clínicas pendientes de aprobación profesional. |
| **Llamador de recepción** · publicado | D · revisión A; [PR181 publicada](https://github.com/OsoCordobes/FolioApp/pull/181). Pantalla con código y destino, sin nombres; llamar conserva el turno en sala. [Prueba completa](https://github.com/OsoCordobes/FolioApp/actions/runs/36124468806): vinculación, respuesta perdida sin duplicar, reconexión y revocación; móvil y escritorio revisados. |
| **Google Calendar** · prueba externa pendiente | [Ensayo definido](C05-GOOGLE-PROOF-CONTRACT.md): reserva, cambios, ocupación externa y reintentos. [PR184](https://github.com/OsoCordobes/FolioApp/pull/184) mejora el aviso en celular y está en controles; eso no acredita la integración. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · descarga profesional publicada | C · revisión A; [PR182 publicada](https://github.com/OsoCordobes/FolioApp/pull/182). Historia y archivos juntos; [ensayo exacto de50MiB aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36120282745), incluidos corte de descarga y revocación. Portal del paciente e historias excepcionalmente grandes siguen pendientes. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última publicación comprobada:** [PR183 · protección de la verificación de edad](https://github.com/OsoCordobes/FolioApp/pull/183), 25/09 a las 13:00 (Copenhague); controles posteriores aprobados. Para probar mejoras visibles: Configuración → Pantallas de espera, luego Hoy → Llamar; y Mis datos y solicitudes → Archivo clínico para guardar historia y archivos. **Cuota consultada:** 67% disponible; reserva de cierre: 15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
