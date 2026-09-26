# Folio · actualización del entorno de trabajo

Completada el 26/09/2026. Objetivo: instrucciones actuales, autonomía útil y menos procesos duplicados. Esta revisión cambió la configuración de trabajo, no la aplicación publicada.

## Qué cambió

| Cambio | Motivo y comprobación |
|---|---|
| Astra con razonamiento Ultra como valor predeterminado | Antes figuraba `xhigh`. El catálogo instalado admite `ultra`; el archivo se guardó y Codex cargó la configuración sin errores. Una selección explícita de un chat puede prevalecer. |
| Una guía de Folio | `AGENTS.md` contiene las reglas; `CLAUDE.md` remite a ella. Se actualizaron las copias del Escritorio y del manager. Se retiraron cifras volátiles, recetas desactualizadas y la instrucción de conservar la marca marrón/crema. |
| Autonomía con resultados | Se explicitan trabajo hasta completar el paquete, delegación útil, evidencia proporcional, continuidad y la reserva acordada. No se exige usar todos los agentes ni repetir pruebas aprobadas. |
| Superpowers desactivado, reversible | Sus recetas generales incluyen invocar skills antes de toda respuesta. Se mantienen las herramientas y las skills especializadas de diseño, datos y proveedores. |
| Claude-Mem adicional desactivado, reversible | Añadía una segunda capa de observación y resumen automático, con hooks en cada uso de herramientas y final de turno. Se conservan sus archivos históricos y la configuración de memoria nativa de Codex. No se midió su coste ni se atribuye a este plugin un error concreto. |
| Cinco entradas de skills desactivadas | La skill `update-cli-config` describía Cursor como si fuera Codex. Cuatro entradas eran las dos skills Supabase locales, duplicadas en Escritorio y manager; las equivalentes de los plugins se conservan. Otros checkouts antiguos pueden conservar sus propias copias: revisar al retomarlos, sin modificar evidencia histórica. |

Los agentes `instruction_audit` y `hooks_audit` hicieron revisiones separadas de reglas y automatismos; el manager aplicó los cambios y comprobó la lectura posterior. Una observación inicial sobre el color fue descartada al contrastarla con la decisión explícita del usuario y el tablero: los tokens antiguos del CSS no cambian la identidad acordada.

## Qué se conservó

Permisos y confianza de hooks, secretos, conexiones, controles de seguridad, historial y respaldos. No se modificaron memoria histórica, archivos de entorno, datos clínicos, políticas, pagos, envíos, Google ni código de la aplicación. No se editaron cachés de plugins ni se desinstalaron paquetes. Flow-Next no mostró hooks automáticos y permanece disponible; Vercel y security-guidance permanecen habilitados.

El diagnóstico de Codex validó configuración, autenticación y arranque del servidor de la aplicación. Mantiene advertencias del entorno; en la consola externa falta `CODEX_WINDOWS_REGISTERED_CORE` para un servidor opcional. No se inventó esa variable ni se deshabilitó una herramienta de la aplicación por esa advertencia.

## Alcance y uso

Reiniciar Codex permite cargar el conjunto actualizado de plugins y skills. El valor guardado no demuestra qué razonamiento usa un turno ya abierto: comprobar Astra / Ultra en el selector del chat. La configuración de este entorno de Codex no equivale a cambiar las instrucciones de un GPT personalizado de ChatGPT.

Ultra queda disponible para dirección y trabajo difícil; las tareas delegadas seguirán usando el modelo y esfuerzo apropiados. No se cambiaron los límites del servicio ni se prometió ejecución ininterrumpida. Tampoco se afirma una mejora porcentual de velocidad, calidad o consumo sin medirla.

Las instrucciones están guardadas en el Escritorio y en la rama del manager para su siguiente integración documental. No se publicó una nueva versión de Folio por esta revisión. PR185 y PR186 siguen abiertas con controles fallidos que deben investigarse antes de integrarlas; no se volvieron a ejecutar ni se aplicaron sus migraciones durante esta tarea.

## Evidencia y reversión

Carpeta local: `C:/Users/amiun/Documents/Codex/folio-agent-setup-20260926/`.

- `applied.json`: valores guardados y comparación que limita los cambios de configuración a los previstos.
- `doctor-after.json`: diagnóstico redactado de Codex; configuración cargada, salida 0. No certifica todos los servicios externos.
- `write-manifest.json`: destinos y hashes antes/después. Escrituras por reemplazo atómico, comprobación contra las copias previas y lectura posterior.
- `config.before.dpapi`: configuración original cifrada para este perfil Windows. `global-AGENTS.before.md`, `desktop-AGENTS.before.md`, `desktop-CLAUDE.before.md` y `manager-CLAUDE.before.md`: guías anteriores.

Para revertir, comparar primero el estado con el manifiesto y restaurar únicamente los cambios de este paquete; no sobrescribir posteriores cambios del usuario. Los plugins también pueden reactivarse desde su configuración sin borrar o restaurar su historial. Las guías anteriores y el borrador inicial se conservaron fuera del repositorio.

## Referencias

La revisión sigue la recomendación de quitar instrucciones redundantes y precisar cuándo aplica cada skill: [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra). Los ajustes se contrastaron con la [referencia de configuración](https://learn.chatgpt.com/docs/config-file/config-reference), el manual oficial actualizado y el catálogo local del modelo.
