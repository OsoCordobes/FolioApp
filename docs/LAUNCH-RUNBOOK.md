# Folio — controles para publicar y abrir el piloto

Orden de entrega actualizado el 12 de septiembre de 2026. Este documento sustituye las recomendaciones
anteriores que trataban correo, respaldos y límites de acceso como opcionales.
La lista de trabajo y la evidencia vigente están en
[el registro de implementación](plans/2026-09-08-market-readiness.md).
**Folio todavía no está habilitado por este proceso para atención clínica real.**

## Evidencia histórica del 8 de septiembre de 2026

Estas observaciones no se reconfirmaron como estado actual en la goal de confiabilidad.
Conservarlas como registro fechado; antes de publicar hace falta inventariar el destino
autorizado. Una referencia Git no prueba qué código está desplegado. La evidencia del
candidato local está en [el registro de confiabilidad](LAUNCH-RELIABILITY-LOG.md).

- En esa consulta, producción tenía el código `2bfbe54137603e373a0fa2ab439d367dedf93415`.
  Las mejoras de seguridad, clínica y operaciones se preparaban en `codex/market-ready`.
- Se recuperaron las 42 variables de producción en un paquete cifrado fuera del
  repositorio. En ese control, las claves pasaban el formato de 32 bytes y no había claves
  `_NEXT` activadas. La frase de recuperación fuera de esta PC seguía pendiente.
- Se registró un checkpoint cifrado y autenticado de la base, roles y configuración
  observada. Storage tenía cuatro buckets y cero objetos. Una restauración de
  estructura seleccionada pasó; el restablecimiento completo del servicio no.
- Se corrigió en Supabase Auth la URL del sitio a `https://foliosalud.com` y se
  retiraron dos entradas de redirección malformadas. Los tres destinos canónicos
  de acceso/portal/contraseña se comprobaron antes y después, sin enviar correo.
  Esta configuración cambió después del checkpoint y tiene registro separado.
- Las reglas observadas de `master` exigían PR, los checks `app-ci` y `sql-specs` con base actualizada,
  resolución de conversaciones e historial lineal. Incluían al admin;
  no permitían borrado ni push forzado. Estaban habilitadas sólo la integración squash
  y la eliminación de la rama remota integrada. **Aprobación humana adicional pendiente en ese registro:**
  había un colaborador; el contador de aprobaciones requerido era cero.

## Antes de cualquier despliegue

1. Registrar commit, checks, migraciones necesarias y operador. Revisar el diff,
   incluidas pruebas y documentación. El video recibido y sus capturas son privados
   y no forman parte de los cambios que se publican.
2. Conservar configuración y un respaldo válido previo. Antes de herramientas que
   puedan escribir variables locales, hacer una copia protegida de `.env.local`.
   No imprimir claves, payloads clínicos ni URLs firmadas en evidencias.
3. Comprobar pruebas de tipos, lint, unidad y compilación aislada, además de SQL
   desde cero con valores por defecto. No usar variables ni proveedores reales
   para esas pruebas. Los stubs SQL no certifican Auth ni Storage reales.
4. Revisar contratos SQL contra las migraciones: un cliente tipado `any` no detecta
   nombres de columnas o funciones incorrectos. No ignorar fallos de lectura.
5. Preparar una versión de retorno compatible. No volver a código que evite MFA,
   escriba originales sin revisión o emita enlaces privados anteriores.

Un hotfix independiente de interfaz puede publicarse con su propia revisión y
checks si no depende de migraciones o interruptores todavía pendientes. Su entrega
no habilita el piloto ni acredita el resto del plan.

## Orden de la entrega que combina base y aplicación

No aplicar todo el directorio de migraciones indiscriminadamente sobre producción.
La etapa de expansión debe mantener funcionando la aplicación anterior.

1. Comparar cada versión canónica con el ledger y los objetos del destino autorizado.
   El [manifiesto local del candidato](LAUNCH-RELIABILITY-MIGRATIONS.md) contiene 23 altas
   frente a la referencia publicada observada, con M118 ya presente. No determinar
   pendientes por el máximo timestamp ni asumir que ese manifiesto inventaría producción.
2. Instalar sólo las versiones faltantes revisadas antes de su código dependiente,
   con ledger en la misma transacción y guards diferidos inicialmente apagados.
   **M104 se instala antes del código; se pospone su activación**, después de verificar
   endpoints y escritores compatibles. Aplicarla sola no cierra el acceso directo antiguo.
3. Preparar y verificar el escritor clínico compatible, activar M106 y sólo entonces
   exponer los consumidores completos del nuevo cierre. CLOSE M120 exige M106 activa
   aunque el guard M120 esté apagado. La versión intermedia debe estar identificada y
   revisada; publicar el final con todos los controles apagados no sustituye ese paso.
4. Integrar mediante PR con checks aprobados y verificar clínica, cierre/recuperación
   y saldo mediante M121 en agenda y Finanzas. Confirmar commit desplegado, región y dominio.
   Activar M120 y luego M121 mediante sus funciones auditadas. No volver a escritores
   antiguos después de esos cortes; conservar una versión de retorno compatible.
5. Preparar y activar los otros controles según sus guías, por separado: MFA del
   personal, consentimiento, adjuntos M104, población y disponibilidad M113. M104 exige
   motivo, SHA completo del build y referencia revisados; M113 exige configuración y
   onboarding compatibles antes de su activación. Cada control necesita su propia evidencia;
   no activar todo automáticamente ni deducir preparación de un cambio de env.
6. Verificar permisos directos por acciones, PostgREST, funciones y archivos antes
   de dar por cerrado el cambio. No desactivar RLS para resolver un incidente.

Guías por frente: [MFA](MFA-ROLLOUT.md), [adjuntos](ADJUNTOS-CLINICOS.md),
[consentimiento y representación](REPRESENTACION-CONSENTIMIENTO.md),
[población de instrumentos](INSTRUMENTOS-POBLACION.md),
[guardado](GUARDADO-CLINICO.md), [cobros](OPERACIONES-COBRO.md),
[Google Calendar](GOOGLE-CALENDAR-CONFIABILIDAD.md),
[contactos familiares](CONTACTOS-FAMILIARES.md),
[disponibilidad](HORARIOS-CONCURRENTES.md),
[cierre y recuperación](M120-TURNO-CLOSE-ATOMIC.md),
[saldo autorizado](M121-PAYMENT-SETTLEMENT.md).

## Puertas del piloto: todas deben quedar aprobadas

| Control | Evidencia que permite aprobarlo |
|---|---|
| Identidad y aislamiento | Dos organizaciones y todos los roles, cuenta dual, revocaciones y AAL1/AAL2 ensayados con Auth/Storage reales. Sin hallazgos críticos o altos abiertos. |
| Historia clínica | Historia extensa completa, enmiendas, adjuntos, exportación y guardado concurrente; acceso autorizado ante suspensión o baja. |
| Menores | Representación y consentimiento por acto, contactos compartidos y población aplicable; aprobación de los tres profesionales. |
| Cobros | Proveedor de prueba controlado: duplicados, eventos desordenados, pérdida de respuesta y recuperación sin doble efecto. |
| Comunicaciones | Dominio y SMTP de producción verificados; cola, cuota y fallos visibles. Mensajes sin información clínica. |
| Respaldo | Copia reciente, recuperación completa demostrada, acceso restablecido y archivos verificados; custodia independiente y copia al disco. |
| Operación | Vercel Pro activo, tareas cada minuto/conciliación verificadas, responsable de soporte y recuperación de cuentas. |
| Capacidad | Informe local y campaña alojada acotada con latencias, errores y consumo medidos, incluyendo espacio sintético conservado. |
| Servicio y profesionales | Títulos/matrículas/alcance comprobados; contratos, privacidad, conservación, transferencias y facturación revisados por responsables competentes. |

La consulta histórica del 8 de septiembre encontró SMTP predeterminado en Supabase.
El envío real y su interruptor de entrega siguen requiriendo evidencia actual del
destino antes de aprobarlos. Google, WhatsApp, recetas y ampliaciones no se ofrecen hasta
aprobar sus circuitos. No interpretar una variable presente como una integración probada.

El limitador debe tener Upstash configurado y verificado, sin la excepción de fallo
abierto. Ver [límites de acceso](LIMITES-DE-ACCESO.md). Los chequeos de salud deben
validar claves y base, pero un HTTP 200 no sustituye estas puertas.

## Incidente o resultado dudoso

- Pausar la funcionalidad afectada o las altas según el problema y proteger el
  acceso autorizado a la información existente. Registrar hora, versión y síntomas
  sin copiar datos clínicos a tickets, chat o analítica.
- Para un guardado incierto, conservar el borrador y comprobar la operación original.
  Para un cobro incierto, conciliar con el proveedor antes de intentar otro.
- Restaurar únicamente siguiendo [respaldos](RESPALDOS.md), sobre destino aislado
  verificado y con prueba previa. La recuperación local no acredita disponibilidad
  alojada ni un tiempo de cuatro horas.
- No borrar historias, aplicar reinicios de base, reutilizar fichas por contacto,
  rotar todas las claves ni bajar la frecuencia del respaldo para resolver una cuota.
- Documentar qué quedó confirmado, qué falta y quién autoriza volver a operar.

## Inicio y crecimiento

Oferta inicial: Solo ARS 30.000 por mes, 30 días de prueba. Piloto de 14 días con
los tres profesionales y al menos cinco jornadas cada uno; medir problemas y tiempo
de soporte sin contenido clínico. Mantener la admisión en 3 → 10 → 25 → 50 → 100 → 200
según capacidad observada y proyección. Avisar al 60% de cuotas y detener nuevas altas
e importaciones masivas al 70%, o antes si la proyección exige reservar capacidad.
No prometer 200 profesionales, disponibilidad continua ni cumplimiento certificado
basándose sólo en pruebas unitarias o en que el sitio responde.
