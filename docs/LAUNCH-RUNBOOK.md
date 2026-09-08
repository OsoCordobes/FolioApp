# Folio — controles para publicar y abrir el piloto

Actualizado el 8 de septiembre de 2026. Este documento sustituye las recomendaciones
anteriores que trataban correo, respaldos y límites de acceso como opcionales.
La lista de trabajo y la evidencia vigente están en
[el registro de implementación](plans/2026-09-08-market-readiness.md).
**Folio todavía no está habilitado por este proceso para atención clínica real.**

## Estado confirmado

- Producción conserva el código `2bfbe54137603e373a0fa2ab439d367dedf93415`.
  Las mejoras de seguridad, clínica y operaciones se preparan en `codex/market-ready`.
- Se recuperaron las 42 variables de producción en un paquete cifrado fuera del
  repositorio. Las claves actuales pasan el formato de 32 bytes y no hay claves
  `_NEXT` activadas. La frase de recuperación fuera de esta PC sigue pendiente.
- Existe un checkpoint cifrado y autenticado de la base, roles y configuración
  observada. Storage tenía cuatro buckets y cero objetos. Una restauración de
  estructura seleccionada pasó; el restablecimiento completo del servicio no.
- Se corrigió en Supabase Auth la URL del sitio a `https://foliosalud.com` y se
  retiraron dos entradas de redirección malformadas. Los tres destinos canónicos
  de acceso/portal/contraseña se comprobaron antes y después, sin enviar correo.
  Esta configuración cambió después del checkpoint y tiene registro separado.
- `master` exige PR, los checks `app-ci` y `sql-specs` con base actualizada,
  resolución de conversaciones e historial lineal. Las reglas incluyen al admin;
  no permiten borrado ni push forzado. Sólo está habilitada la integración squash
  y se elimina la rama remota integrada. **Aprobación humana adicional pendiente:**
  hoy sólo hay un colaborador; el contador de aprobaciones requerido es cero.

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

1. Aplicar las expansiones revisadas M98–M103 y M105 en adelante que el código
   final realmente necesite, registrando sus versiones canónicas. Las migraciones
   todavía en construcción no son instrucciones de despliegue.
2. **Posponer M104**: restringe escrituras de adjuntos y debe ejecutarse después de
   publicar los endpoints y escritores compatibles. Su posición numérica no cambia
   este orden operativo. Registrar y cerrar la diferencia temporal del inventario.
3. Publicar el código compatible mediante PR con checks aprobados y revisar los
   recorridos sintéticos esenciales. Confirmar commit desplegado, región y dominio.
4. Aplicar M104 y las activaciones de una vía según sus guías: preparación/MFA del
   personal, decisiones de consentimiento, población de instrumentos y escritor
   clínico atómico. Cada activación necesita su evidencia, no sólo un cambio de env.
5. Verificar permisos directos por acciones, PostgREST, funciones y archivos antes
   de dar por cerrado el cambio. No desactivar RLS para resolver un incidente.

Guías por frente: [MFA](MFA-ROLLOUT.md), [adjuntos](ADJUNTOS-CLINICOS.md),
[consentimiento y representación](REPRESENTACION-CONSENTIMIENTO.md),
[población de instrumentos](INSTRUMENTOS-POBLACION.md),
[guardado](GUARDADO-CLINICO.md), [cobros](OPERACIONES-COBRO.md),
[Google Calendar](GOOGLE-CALENDAR-CONFIABILIDAD.md),
[contactos familiares](CONTACTOS-FAMILIARES.md).

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

La configuración actual de Supabase conserva SMTP predeterminado; no es la solución
aprobada para producción. Falta provisionar/verificar el envío real y habilitar su
interruptor de entrega. Google, WhatsApp, recetas y ampliaciones no se ofrecen hasta
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
