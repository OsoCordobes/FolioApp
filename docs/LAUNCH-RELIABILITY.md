# Folio: goal de confiabilidad para lanzamiento

Fecha de inicio: 12 de septiembre de 2026. Seguimiento en la tarea `01a09720-6c99-71a1-9160-84dc002c19bb`.

## Resultado buscado

Un candidato de lanzamiento revisable en el que el recorrido **paciente sin turno → atención → guardar consulta → registrar cobro → volver a entrar y reabrir** conserve los datos, detecte conflictos y permita recuperarse de interrupciones sin duplicar operaciones ni anunciar éxitos no comprobados.

La entrega debe incluir correcciones implementadas, pruebas reproducibles, revisión independiente y condiciones explícitas de publicación. Esta goal no autoriza despliegues, migraciones de producción, cobros reales ni nuevas contrataciones. Un candidato probado localmente no equivale a un lanzamiento público aprobado.

## Entorno y coordinación

- Copia propia: `C:/Users/amiun/Documents/Codex/folio-reliability`.
- Rama: `codex/launch-reliability`; base fija: `11f020685f15cd65be61b030e1f628d2ad6a6941` de `codex/market-ready`.
- `master` observado al inicio: `2dae580`. La base contiene trabajo previo aún no integrado; revisar esas dependencias antes de publicar. No se presenta como una rama basada únicamente en producción.
- Checkpoint combinado `34dc605`: incorporó la visual publicada observada en `28ab28a` y los consumidores de servidor revisados. El corte posterior `3a9823a` también contiene la UI y el ensayo revisados. Frente a `28ab28a` hay **23 migraciones nuevas**, no sólo M120/M121; M98–M117 y M119 son dependencias heredadas. El [manifiesto](LAUNCH-RELIABILITY-MIGRATIONS.md) documenta esa comparación. El estado remoto y el inventario productivo no se deducen de estas referencias locales.
- La tarea visual trabaja en `C:/Users/amiun/Documents/Codex/folio-experience`, rama `codex/folio-experience`, servidor 4410. No modificar su copia ni detener su servidor.
- Priorizar lógica de servidor, persistencia y pruebas. Registrar cualquier contrato o componente compartido que necesite integración con la rama visual.
- Datos exclusivamente sintéticos. No leer `.env.local` para ejecutar pruebas. Conservar los bloqueos de red y credenciales del entorno de ensayo.
- `vercel.json` desactiva el despliegue automático por Git de `codex/launch-reliability`, además de la rama heredada `codex/market-ready`, para poder entregar la revisión sin desplegar el candidato. Es la configuración documentada de [Vercel por rama](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled); no bloquea una invocación manual de despliegue ni autoriza integrar en master.

## Iteraciones y criterios de cierre

| Iteración | Trabajo | Evidencia necesaria para cerrar |
|---|---|---|
| 1. Diagnóstico reproducible | Inventariar protecciones y ramas; ejecutar base; reproducir riesgos de cierre/cobro y preparar el ensayo clínico | Contratos y casos documentados; resultados vinculados al código; fallos demostrados antes de corregir |
| 2. Corrección y recuperación | Resolver operaciones parciales, éxitos falsos, respuestas perdidas y conflictos simultáneos | Cada defecto tiene prueba de fallo, corrección y repetición satisfactoria; los datos anteriores se conservan |
| 3. Recorrido completo | Probar guardado, cierre, cobro y reapertura, con negativos de acceso y servicios reales locales | Supabase Auth/MFA y Storage reales; conteos y contenido persistidos; pruebas sin omisiones; distinguir registro de efectivo de Mercado Pago |
| 4. Candidato de lanzamiento | Revisión independiente, verificaciones pertinentes e integración preparada | Cero defectos críticos/altos abiertos dentro del alcance; evidencia de la revisión exacta; migraciones y compatibilidad ordenadas; checklist de publicación con pendientes externos |

Cada vuelta: **reproducir → priorizar → corregir la causa → verificar → revisar → guardar avance**. Completar primero este recorrido; ampliar el alcance sólo ante un riesgo concreto que impida su confiabilidad o el lanzamiento.

## Hallazgos iniciales

1. `transitionTurno` actualiza el turno y registra el pago en solicitudes distintas. Si falla el pago, puede quedar cerrado sin movimiento financiero. La instrucción de recuperarlo en Finanzas no corresponde a una acción de alta de pago disponible.
2. `marcarPagoCobradoAction` sólo comprueba el error del UPDATE; no verifica las filas modificadas. Cero filas puede significar pérdida de permiso, no sólo que otra persona ya cobró.
3. El conteo final de `tests/e2e/clinical-path.spec.ts` filtra `pago.organization_id`, columna inexistente. La organización se obtiene mediante `pago.turno_id → turno.organization_id`.
4. El ensayo clínico usa el puerto 4410, ocupado por la tarea visual. Preparar un puerto dedicado y mantener las comprobaciones de aislamiento.

Estos hallazgos vienen de lectura de código al inicio. La reproducción y la evidencia de cada corrección se registran por separado; no se declaran errores observados en producción.

## Avance comprobado al 13 de septiembre

- El baseline de 113 migraciones aprobó **7/7** con Auth/MFA/Storage reales locales. Ese resultado no cubre M120/M121. Los **doce casos reales del candidato de 115 migraciones siguen pendientes**.
- La UI de cierre/recuperación recibió aprobación independiente en `8a802e0`, con **36/36 pruebas de navegador aisladas**. El ensayo integrado recibió aprobación en `3a9823a`; ese corte aprobó tipos, lint focal del ensayo, **2180/2180 unitarias y 18/18 comprobaciones focales de seguridad**. La compilación aislada aprobada es la de `fa5787e`; los cambios posteriores sólo afectan pruebas y documentación. No se atribuye un nuevo build al SHA posterior.
- El operador local fue aprobado con digest `ab0ee28ebff099e5ebabc09f9795706c1237461e36a19c6f04f4c27edc0feecb` y **7/7 pruebas puras**. el arranque de Docker está en reparación por un socket temporal y el conductor prepara el preflight; **todavía no se ejecutó DDL ni se activaron M120/M121 en el runtime clínico**. Las pruebas del operador no son evidencia del recorrido real.

## Pendientes del candidato y condiciones de publicación

- Preservar y actualizar el runtime local al SHA revisado, aplicar las dos migraciones y activar sus controles auditados con M106 ya activa. Ejecutar los doce escenarios sin carga pesada concurrente y cerrar la revisión del resultado. Registrar cualquier fallo y sus correcciones antes de afirmar que el candidato cumple el recorrido.
- Revisar migraciones pendientes y controles activables; instalar cambios compatibles antes del código sólo con autorización de publicación.
- Validar acceso y recuperación de cuenta, reserva pública, comunicaciones y pagos de proveedor en entorno autorizado; el registro de efectivo no cubre la suscripción de Folio.
- Completar la restauración integral, responsables de soporte y validaciones profesionales/comerciales aplicables. Esta goal no certifica por sí sola estos requisitos.

## Evidencia inicial

- Dependencias instaladas desde caché con lockfile fijo, sin archivos de entorno en esta copia.
- `pnpm test:unit`: **2111 aprobadas, 0 fallidas, 0 omitidas**, sobre la base 11f0206. Log local: `.flow/launch-reliability/baseline-unit.log`.
- Se preparó PostgreSQL16 dedicado en loopback 55439 para los ensayos SQL; esa evidencia usa stubs de Auth/Storage.
- Estado de avance y próximas acciones: [registro de iteraciones](LAUNCH-RELIABILITY-LOG.md).

## Dependencia de instalación y activación

La actualización de 92 migraciones publicadas a las 115 del candidato pasó en PostgreSQL16 local, incluso con M118 instalada antes de las 23 faltantes. Esto acredita compatibilidad del orden sobre una base sintética nueva; no valida el inventario ni la conversión de datos de un destino productivo.

El orden operativo requiere **escritor clínico compatible → M106 activa → exponer los nuevos consumidores de cierre → M120 activa → M121 activa**. El CLOSE nuevo exige M106 aunque el guard M120 esté apagado; por tanto, aplicar los archivos con todos los controles apagados y desplegar el final no basta. Las activaciones heredadas de MFA, consentimiento, adjuntos, población y disponibilidad conservan sus propias condiciones. El inventario del destino y la autorización de publicación siguen pendientes.
