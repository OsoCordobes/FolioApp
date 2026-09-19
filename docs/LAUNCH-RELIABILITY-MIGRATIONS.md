# Dependencias de migración del candidato de confiabilidad

Inventario actualizado el 19 de septiembre de 2026. Referencia publicada observada:
`28ab28a93798b09c2a4e092e9cceb0f163262f9e`; candidato SQL combinado:
`17a377039e9f9812d80d23593c851a6fe86bf7de`. La comparación de Git se complementó
con consultas de sólo lectura del ledger productivo del 13/09 y del 19/09 entre
15:14 y 15:18 UTC: 92 versiones, iguales
al conjunto de la referencia, y las 25 siguientes ausentes. El catálogo confirmó
también ausencia de MFA, M106, M120, M121 y la RPC de M122. No hubo DDL ni activaciones productivas.

La referencia contiene 92 migraciones; el candidato, 117. Hay **25 altas y cero
modificaciones o eliminaciones** de archivos existentes. M118, versión `20260912163934`,
ya está en la referencia y sus bytes coinciden. No aplicarla de nuevo por omisión
del inventario. La diferencia frente a la base heredada `11f0206` es M120–M123;
las otras 21 altas son dependencias de ese trabajo previo.

| Versión canónica | Migración |
|---|---|
| 20260908162341 | M98 — límites de seguridad |
| 20260908163016 | M99 — persistencia de cobros de suscripción |
| 20260908163939 | M100 — entrega de correo y marca sintética |
| 20260908170427 | M101 — MFA del personal |
| 20260908172503 | M102 — expansión de adjuntos clínicos |
| 20260908172934 | M103 — representación y consentimiento |
| 20260908174149 | M104 — control de acceso de adjuntos |
| 20260908174800 | M105 — población de instrumentos |
| 20260908175754 | M106 — revisión y escritura clínica atómica |
| 20260908175852 | M107 — persistencia de Google Calendar |
| 20260908183408 | M108 — agregados financieros |
| 20260908183732 | M109 — contactos familiares compartidos |
| 20260908184053 | M110 — reserva atómica |
| 20260908190005 | M111 — revisión de agenda |
| 20260908190255 | M112 — importación de pacientes |
| 20260908192500 | M113 — revisión de disponibilidad |
| 20260908194000 | M114 — directorio de pacientes |
| 20260908200500 | M115 — panel de operaciones |
| 20260908214500 | M116 — retiro de pseudonimización de pacientes |
| 20260912161705 | M117 — creación manual atómica de turno |
| 20260912170202 | M119 — reprogramación atómica |
| 20260912200817 | M120 — cierre y registro administrativo atómicos |
| 20260912204646 | M121 — saldo con autorización vigente |
| 20260913040500 | M122 — lectura operacional de Hoy para recepción |
| 20260913043000 | M123 — lectura de pagos limitada a roles financieros |

## Evidencia local del orden de actualización

En una base nueva PostgreSQL16.15 se instalaron primero los 92 archivos exactos de
`28ab28a`, incluida M118; luego las 23 altas anteriores del candidato, y finalmente
las 63 specs SQL. **Todo aprobó, exit 0** sobre el candidato histórico `34dc605`: 115 versiones exactas en el ledger,
M118 una sola vez y cero autoridades temporales al terminar. Se comprobaron 182 hashes
de entradas congeladas y se mantuvo la verificación predeterminada de cuerpos de funciones.
Base e informe se conservan: `.flow/launch-reliability/published-upgrade-report.md`.

Este ensayo cubre el orden con versiones anteriores faltantes después de M118,
además del replay cronológico completo previamente aprobado. Usa stubs SQL de
Auth/Storage; no convierte un inventario de datos productivos ni prueba servicios
Supabase reales, despliegue o activaciones permanentes en el destino.

Después del replay local de M122 (**116 migraciones / 64 specs**) y de la regresión
focal de M123 con cinco specs afectadas, GitHub aprobó el **replay completo de
117 migraciones / 65 specs** sobre `cae1a3d` el 13/09. Esa evidencia usa PostgreSQL16
con stubs y no extiende el ensayo histórico de actualización desde 92 hasta 117.

El 19/09 se instalaron M122 y M123 con ambos registros canónicos en **una transacción**
del runtime clínico PG17, de 115 a 117 versiones. El preflight posterior por conexión
nueva aprobó; se conservaron 21 tablas, ambos volúmenes, los nueve controles y la
auditoría original de activación `3a9823a`. No se reinstalaron M120/M121 ni se repitieron
activaciones. Los digests SQL y las entradas canónicas se comprobaron antes y después
del corte. Esta instalación local no aplica las 25 migraciones pendientes de producción.

## Preparación necesaria en un destino autorizado

- Comparar todas las versiones y objetos; no usar el máximo timestamp como señal
  de integridad ni marcar archivos como aplicados sin ejecutarlos.
- Revisar compatibilidad y datos existentes de las 25 dependencias. Varias cambian
  funciones, permisos y triggers; no tratarlas todas como expansiones inocuas.
- Registrar cada migración y su versión canónica en la misma transacción.
  Conservar los archivos aplicados; no reescribir su esquema retroactivamente.
- Separar instalación de activación. M104 se instala antes del código compatible
  y se activa después de verificar sus rutas. El cierre requiere escritor clínico
  compatible → M106 activa → consumidores completos → M120 activa → M121 activa.
- Mantener las condiciones propias de MFA, consentimiento, adjuntos, población y
  disponibilidad. Después de un corte, la versión de retorno debe respetar esos controles.
- Instalar M122 antes del lector de Hoy dependiente y M123 antes de acreditar
  el aislamiento financiero de COORDINADOR. M122 concede USAGE del esquema privado
  existente al rol autenticado; sus tablas y funciones internas anteriores siguen
  denegadas. M123 agrega una política restrictiva de SELECT, sin cambiar escrituras.

El puente del escritor M106, `efe19c68c849696d7d66bc8a43014ac494eb3310`, tiene despliegue
`dpl_J7Pk9fWqzTF1aCyucVWmjMgz9YN6` READY en gru1, sin promoción al dominio publicado.
Su comprobación anónima dio health 200, login 200 y Hoy 307 hacia login; el dominio
publicado mantuvo health 200. Esto no acredita escrituras autenticadas, instalación
de las 25 migraciones, activaciones ni merge. El
[runbook](LAUNCH-RUNBOOK.md) y las guías por migración detallan el orden restante.
Este manifiesto no autoriza ejecutarlo ni certifica la preparación integral del lanzamiento.
