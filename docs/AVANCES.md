# Folio · avances comprobables

Actualizado: 26/09/2026. Este es el registro breve del trabajo; [el tablero técnico](LAUNCH-BOARD.md) conserva el detalle y los antecedentes. Cada fila cambia sólo ante un resultado o bloqueo real.

**Equipo comprobado:** **B** dirige producto y acceso; **C**, continuidad, proveedores y soporte; **D**, calidad y piloto; el chat de **landing**, diseño. El nuevo chat de **legal/privacidad/SEO/rendimiento** también está activo y fijado. **A** dirige prioridades, recursos y aceptación; B se encarga de la integración técnica. Dos frentes modifican la aplicación, los demás revisan y preparan decisiones.

**Regla de evidencia:** cada encargo tiene una razón, alcance y condición de cierre. Al terminar deja el cambio, una prueba verificable y sus límites; A contrasta el resultado antes de marcarlo terminado. Un fallo se conserva y sólo se repite la prueba cuando hay información o una corrección nueva.

**Cómo verlo:** [panel de avances](http://127.0.0.1:4420/) con19 checkpoints, lectura del registro y actualización cada minuto. Funciona en esta computadora mientras el proceso esté activo; este archivo y la copia en Git conservan el avance aunque se cierre el panel.

**Publicado** = disponible en Folio. **Probado** = pasó sus controles, todavía sin publicar. **En curso** = falta comprobarlo. Las pruebas parciales no cierran un checkpoint completo.

| Checkpoint | Resultado, responsable y prueba |
|---|---|
| **Forma de trabajo** · actualizada e integrada | Astra Ultra predeterminado, guía única y procesos duplicados desactivados de forma reversible. Dos revisores y A; [informe](AGENT-SETUP-20260926.md) y [guía integrada](https://github.com/OsoCordobes/FolioApp/pull/187) para futuras sesiones. |
| **Landing de Folio** · primera versión visible | [Vista en vivo](http://127.0.0.1:4440/): nueva portada y recorrido del consultorio con identidad violeta; A comprobó la pantalla real. El chat dedicado termina revisión móvil/escritorio, textos e interacciones; todavía no publicada. |
| **Ingreso y onboarding** · acceso y servicios publicados | [PR175](https://github.com/OsoCordobes/FolioApp/pull/175): registro y recuperación. D · revisión A; [PR177 publicada](https://github.com/OsoCordobes/FolioApp/pull/177): servicios conservados al volver y ante respuesta perdida, [prueba Solo/Clínica](https://github.com/OsoCordobes/FolioApp/actions/runs/36088410093). |
| **Permisos de Clínica** · dos paquetes publicados | Pedidos y motivos protegidos según el rol: [PR170](https://github.com/OsoCordobes/FolioApp/pull/170). C · revisión A; [PR174 publicada](https://github.com/OsoCordobes/FolioApp/pull/174) impide entregar una firma si se revoca el acceso durante su descarga. |
| **Recuperación completa** · ensayo aprobado e integrado | Datos, archivos, contraseña y segundo factor recuperados con datos ficticios. C · revisión A. [Prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36073216478), [entrega integrada](https://github.com/OsoCordobes/FolioApp/pull/167); custodia externa pendiente. |
| **Miniweb profesional** · publicada | Dos disposiciones, mapa confirmado, editor y enlace individual con permiso propio. D · revisión A. [Publicación verificada](https://github.com/OsoCordobes/FolioApp/pull/171) y [prueba del permiso](https://github.com/OsoCordobes/FolioApp/actions/runs/36076159519). |
| **Trabajo de recepción** · publicada | Agenda publicada con el alcance de Asistente y Coordinador. C · revisión A; [entrega](https://github.com/OsoCordobes/FolioApp/pull/172). [Prueba aprobada, sin omisiones](https://github.com/OsoCordobes/FolioApp/actions/runs/36076854795). |
| **Atención adulta** · base y refuerzo publicados | [PR185 publicada](https://github.com/OsoCordobes/FolioApp/pull/185): protege la operación si se revoca el permiso al mismo tiempo; [prueba aprobada](https://github.com/OsoCordobes/FolioApp/actions/runs/36264573370). Instalación y lectura posterior conservan los datos y controles. Interfaz y criterio profesional siguen pendientes. |
| **Ficha completada por el paciente** · formulario probado | [Recorrido completo aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36274410810): formulario, QR, respuestas perdidas, revocación y conservación de datos. [PR188](https://github.com/OsoCordobes/FolioApp/pull/188) espera aclarar el fallo del control de servicios antes de publicar; incorporar campos sigue pendiente. |
| **Llamador de recepción** · publicado | D · revisión A; [PR181 publicada](https://github.com/OsoCordobes/FolioApp/pull/181). Pantalla con código y destino, sin nombres; llamar conserva el turno en sala. [Prueba completa](https://github.com/OsoCordobes/FolioApp/actions/runs/36124468806): vinculación, respuesta perdida sin duplicar, reconexión y revocación; móvil y escritorio revisados. |
| **Google Calendar** · prueba externa pendiente | [Ensayo definido](C05-GOOGLE-PROOF-CONTRACT.md): reserva, cambios, ocupación externa y reintentos. [PR184 publicada](https://github.com/OsoCordobes/FolioApp/pull/184) mejora el aviso en celular; eso no acredita la integración. |
| **Correo y comunicaciones** · prueba externa pendiente | La entrega global sigue desactivada; falta comprobar recepción y reintentos en buzones controlados. |
| **Pagos y suscripciones** · prueba externa pendiente | Los cobros ficticios previos no prueban Mercado Pago real; faltan los recorridos comerciales ofrecidos. |
| **Portal y exportación** · descarga profesional publicada | C · revisión A; [PR182 publicada](https://github.com/OsoCordobes/FolioApp/pull/182). Historia y archivos juntos; [ensayo exacto de50MiB aprobado](https://github.com/OsoCordobes/FolioApp/actions/runs/36120282745), incluidos corte de descarga y revocación. Portal del paciente e historias excepcionalmente grandes siguen pendientes. |
| **Continuidad y soporte** · pendiente | Faltan custodia externa, alertas, responsables y procedimiento de ayuda comprobados. |
| **Legal, privacidad y cookies** · revisión en curso | Chat dedicado activo y fijado: contrasta textos, datos tratados, proveedores y cookies con fuentes oficiales. Entregará hallazgos y decisiones que requieran al titular o asesoría; todavía no acredita cumplimiento. |
| **SEO y rendimiento** · agregado al plan | El mismo chat revisará visibilidad en buscadores, enlaces y velocidad, coordinado con la nueva landing. Cada corrección tendrá medición o prueba concreta; no cambia el diseño en paralelo. |
| **Validación profesional y piloto** · pendiente humano | Cinco especialidades y piloto de 14 días, con tres profesionales y cinco jornadas por persona. |
| **Lanzamiento** · pendiente | Se cerrará cuando la versión publicada y la oferta comercial coincidan con lo demostrado. |

**Última mejora de aplicación comprobada:** [PR186 · base privada de la ficha](https://github.com/OsoCordobes/FolioApp/pull/186), también aprobó su control posterior; todavía no habilita el formulario. Las guías compartidas de [PR187](https://github.com/OsoCordobes/FolioApp/pull/187) también quedaron publicadas y comprobadas. Para probar mejoras visibles anteriores: Configuración → Pantallas de espera, luego Hoy → Llamar; y Mis datos y solicitudes → Archivo clínico para guardar historia y archivos. **Cuota consultada el 26/09 a las 21:05 UTC:** 91% disponible; no es una lectura en tiempo real. Reserva de cierre: 15%.

**Forma de trabajo:** continuar mientras haya trabajo útil, cerrar cada paquete con evidencia y tomar el siguiente. La reanudación horaria es respaldo ante un corte, no una espera entre tareas.

Últimos cierres: **B05a, 25/09** · publicado y comprobado; **C01, 25/09 01:44** · integrado tras aprobar sus controles; **D06a, 25/09** · plantilla aprobada en móvil/escritorio. Horario de Copenhague; evidencia enlazada en cada fila.
