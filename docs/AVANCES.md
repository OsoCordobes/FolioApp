# Folio · avances comprobables

Actualizado: 26/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** A dirige y revisa. `access_proof_repair` completa la prueba del formulario; `intake_sql_repair` prepara su instalación controlada. La interfaz de `patient_form_delivery` pasó sus pruebas iniciales y tiene una corrección de privacidad pendiente de revisión. Dos escritores; `intake_cancel_review` prepara el siguiente paso sin modificar la aplicación.

**Cómo verlo:** [panel de avances](http://127.0.0.1:4420/) recuperado y comprobado el26/09:16 checkpoints, lectura del registro y actualización cada minuto. Funciona en esta computadora mientras el proceso esté activo; este archivo y la copia en Git conservan el avance aunque se cierre el panel.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Forma de trabajo** · actualizada e integrada | Astra Ultra predeterminado, guía única y procesos duplicados desactivados de forma reversible. Dos revisores y A; [informe](AGENT-SETUP-20260926.md) y [guía integrada](https://github.com/OsoCordobes/FolioApp/pull/187) para futuras sesiones. |
| **Ingreso y onboarding** · acceso y servicios publicados | [PR175](https://github.com/OsoCordobes/FolioApp/pull/175): registro y recuperación. D · revisión A; [PR177 publicada](https://github.com/OsoCordobes/FolioApp/pull/177): servicios conservados al volver y ante respuesta perdida, [prueba Solo/Clínica](https://github.com/OsoCordobes/FolioApp/actions/runs/36088410093). |
| **Permisos de Clínica** · dos paquetes publicados | Pedidos y motivos protegidos según el rol: [PR170](https://github.com/OsoCordobes/FolioApp/pull/170). C · revisión A; [PR174 publicada](https://github.com/OsoCordobes/FolioApp/pull/174) impide entregar una firma si se revoca el acceso durante su descarga. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · publicada | Dos disposiciones, mapa confirmado, editor y enlace individual con permiso propio. D · revisión A. [Publicación verificada](https://github.com/OsoCordobes/FolioApp/pull/171) y [prueba del permiso](https://github.com/OsoCordobes/FolioApp/actions/runs/36076159519). |
| **Trabajo de recepción** · publicada | Agenda publicada con el alcance de Asistente y Coordinador. C · revisión A; [entrega](https://github.com/OsoCordobes/FolioApp/pull/172). [Prueba aprobada, sin omisiones](https://github.com/OsoCordobes/FolioApp/actions/runs/36076854795). |
| **Atención adulta** · base y refuerzo publicados | [PR185 publicada](https://github.com/OsoCordobes/FolioApp/pull/185): protege la operación si se revoca el permiso al mismo tiempo; [prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36264573370). Instalación y lectura posterior conservan los datos y controles. Interfaz y criterio profesional siguen pendientes. |
| **Ficha completada por el paciente** · base publicada; formulario en revisión | [PR186 publicada y comprobada](https://github.com/OsoCordobes/FolioApp/pull/186), datos previos conservados. Formulario y QR pasan sus pruebas iniciales; la revisión detectó datos que podían quedar visibles al cambiar de sesión. Se corrige antes de comprobar el recorrido completo y publicarlo. |
| **Llamador de recepción** · publicado | D · revisión A; [PR181 publicada](https://github.com/OsoCordobes/FolioApp/pull/181). Pantalla con código y destino, sin nombres; llamar conserva el turno en sala. [Prueba completa](https://github.com/OsoCordobes/FolioApp/actions/runs/36124468806): vinculación, respuesta perdida sin duplicar, reconexión y revocación; móvil y escritorio revisados. |
| **Google Calendar** · prueba externa pendiente | [Ensayo definido](C05-GOOGLE-PROOF-CONTRACT.md): reserva, cambios, ocupación externa y reintentos. [PR184 publicada](https://github.com/OsoCordobes/FolioApp/pull/184) mejora el aviso en celular; eso no acredita la integración. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · descarga profesional publicada | C · revisión A; [PR182 publicada](https://github.com/OsoCordobes/FolioApp/pull/182). Historia y archivos juntos; [ensayo exacto de50MiB aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36120282745), incluidos corte de descarga y revocación. Portal del paciente e historias excepcionalmente grandes siguen pendientes. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última mejora de aplicación comprobada:** [PR186 · base privada de la ficha](https://github.com/OsoCordobes/FolioApp/pull/186), también aprobó su control posterior; todavía no habilita el formulario. Las guías compartidas de [PR187](https://github.com/OsoCordobes/FolioApp/pull/187) también quedaron publicadas y comprobadas. Para probar mejoras visibles anteriores: Configuración → Pantallas de espera, luego Hoy → Llamar; y Mis datos y solicitudes → Archivo clínico para guardar historia y archivos. **Cuota consultada el 26/09:** 93% disponible; no es una lectura en tiempo real. Reserva de cierre: 15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
