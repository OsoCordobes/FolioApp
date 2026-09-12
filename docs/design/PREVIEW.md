# Vista previa de la experiencia

La ruta `/dev/experience?panel=hoy` monta los componentes reales con registros
enteramente ficticios. No consulta una sesión ni habilita las rutas privadas.
Devuelve 404 en producción y cuando falta `FOLIO_TEST_ISOLATED=1`.

## Paneles

El selector «Vista previa» permite recorrer `hoy`, `calendario`, `pacientes`,
`ficha`, `finanzas`, `configuracion`, `onboarding`, `portal-turnos`,
`portal-resumen` y `portal-perfil`. La barra lateral y la navegación móvil son
los componentes de producción. Sus enlaces se redirigen al panel equivalente
dentro de la vista previa. Las filas de pacientes abren la ficha ficticia.
`&state=empty` muestra estados vacíos de Hoy, pacientes y los tres paneles del
portal. `&step=2` a `&step=6` permite inspeccionar directamente los formularios
de onboarding sin completar ni guardar los pasos anteriores.

Los datos están en `app/dev/experience/fixtures.ts`; los contratos se comprueban
con tipos importados de los componentes y del dominio. No se copian consultas,
acciones de servidor ni reglas clínicas. La fecha de las muestras es el
10 de septiembre de 2026.

## Aislamiento

Arrancar únicamente con `scripts/testing/app-bootstrap.mjs`, en el puerto
dedicado 4410. Ese bootstrap limpia variables, aporta claves sintéticas y
bloquea conexiones externas. No reutilizar el servidor de trabajo 3010 ni
cargar `.env.local`.

La vista añade un segundo límite en el navegador antes de montar componentes:
rechaza POST, Server Actions, solicitudes API y hosts externos por `fetch`.
El límite se retira al desmontar la vista. Los enlaces externos y los controles
de guardar, enviar y conectar presentan un aviso explícito; no simulan éxito.
Los filtros, búsquedas y pestañas que funcionan en memoria se pueden explorar.
Los rechazos de transporte que genera este límite se identifican por su mensaje
exacto y no abren el overlay de desarrollo de Next. Las demás excepciones siguen
su manejo normal; no se sustituyen datos ni se simulan guardados.

## Límites de la inspección

- Hoy y calendario omiten `organizationId`, por lo que no activan polling ni
  realtime. Los cambios de fecha/periodo no recalculan datos; son fixtures fijos.
- No existe autenticación, persistencia, confirmación real de turnos ni cobro.
- Configuración se monta con `canEdit=false`; sus apartados son consultables.
- La ficha no tiene turno activo: no habilita un guardado clínico ficticio.
  Documentos y consentimientos que se cargan por acciones quedan limitados.
- Onboarding empieza en el paso 2 con datos ficticios y sin organizationId:
  no crea cuentas ni autoguarda. La finalización y conexión Google necesitan
  un backend de prueba. No se anuncia una alta exitosa.
- Portal usa `TurnosList`, `ResumenView`, `PerfilList` y `PortalNav` reales.
  No se monta `ConsentimientosView`: ese componente autoconsulta el servidor
  y no acepta datos iniciales. Los consentimientos de ejemplo se ven dentro
  del resumen presentacional.
- Sidebar y PortalNav calculan el elemento activo con la URL real. Como esta
  galería conserva `/dev/experience`, no se falsifica ese contexto de ruta.
  `preview.module.css` marca visualmente el panel correspondiente mediante el
  atributo `data-preview-panel`; el selector propio aporta `aria-current`.
- Cada panel tiene un error boundary para permitir continuar con el resto
  de vistas si un componente requiere datos no incluidos en el fixture.

Esta galería sirve para inspección visual y comportamiento local. No acredita
Auth, RLS, persistencia, integraciones o funcionamiento de producción.

## Verificación de la infraestructura

Durante la implementación se comprobaron los diez paneles con Chromium local a
1440 × 1000 y 390 × 844: todos montaron sin errores de página. La navegación
Sidebar → pacientes → ficha permaneció dentro de `/dev/experience`. El botón
«Sin turno» y un POST de prueba quedaron bloqueados sin solicitudes no-GET.
`pnpm typecheck` y el lint de `app/dev/experience` pasaron.

Con la hoja de estilos vigente durante esta comprobación, onboarding paso 2
mostró 28px de desborde a 390px; el resto no desbordó. Estas mediciones son de
infraestructura: repetir la inspección visual cuando se integre el rediseño CSS.
