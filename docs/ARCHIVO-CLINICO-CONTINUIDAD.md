# Archivo clínico durante suspensión comercial

Implementación del 12 de septiembre de 2026 en `codex/market-ready`. Pendiente de despliegue junto con sus dependencias M101/M114 y de prueba con Auth/RLS reales.

`/archivo-clinico` queda fuera del layout que redirige por falta de pago. Facturación y Mis datos enlazan esta pantalla. Permite buscar pacientes, paginar de a 50 y preparar el PDF o JSON mediante las rutas de entrega existentes. La consulta no crea pacientes, atenciones ni movimientos y no modifica la suscripción.

La identidad, MFA y membresía se comprueban antes y después de leer. El directorio mantiene RLS y caja fuerte; el contexto de organización y miembro se fija desde la sesión. El navegador no puede elegir otra organización. La entrega completa exige OWNER o DIRECTOR colegiado, de acuerdo con el alcance de sesiones M46; no amplía a PROFESIONAL el historial ajeno. Cada descarga vuelve a comprobar sus propios permisos de paciente y sesiones. Para profesionales con alcance parcial y para una baja que retiró la membresía, continúa el circuito humano de entrega autorizada.

La búsqueda exacta por nombre y apellido completos, DNI o teléfono viaja en una acción de servidor, sin nombres o documentos en URL. El cursor conserva la consulta enviada, aunque se edite después el campo. La respuesta de esta pantalla sólo devuelve ID y nombre; omite teléfonos, correos, etiquetas e información de sesiones.

Una búsqueda interrumpida conserva resultados anteriores y el texto escrito. Las descargas no guardan páginas de login, respuestas de error o documentos vacíos como si fueran historias. Redirección de sesión, permiso insuficiente, tamaño excedido e interrupción se informan expresamente. Se evita repetir solicitudes pendientes. El navegador recibe un archivo sólo después de completar la respuesta; el aviso confirma preparación, no prueba que el usuario lo haya guardado.

No constituye un archivo integral de adjuntos ni un snapshot entre categorías. Se mantienen los límites de los exportadores actuales; los adjuntos, los límites excedidos y situaciones de representación o permisos requieren la entrega revisada existente. La pantalla indica ese alcance.

Verificación: 15 pruebas negativas y de alcance; 18 escenarios de navegador real con React desarrollo/producción, servidor sintético aislado, búsqueda, paginación, descarga, respuestas 403/413/302/HTML, móvil y teclado. Revisión independiente de permisos aprobada; se corrigió la indicación de búsqueda para exigir nombre completo. Estas pruebas no sustituyen Auth/Storage reales ni prueban disponibilidad alojada.
