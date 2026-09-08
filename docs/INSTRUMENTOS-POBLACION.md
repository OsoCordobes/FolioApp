# Restricción poblacional de instrumentos

La política `adult-only-pending-validation.v1` permite nuevas clasificaciones sólo
con fecha de nacimiento válida y edad de al menos 18 años en la fecha de atención.
**Es una restricción operativa provisional, no evidencia de validación adulta.**
La validación por profesionales de cada versión, idioma y población sigue pendiente
antes del lanzamiento. No se establecieron umbrales pediátricos ni se modificaron
fórmulas para aparentar esa validación.

La biblioteca aplica este criterio a PHQ-9, GAD-7, DASS-21, PCL-5, C-SSRS, NDI,
ODI, Borg y la clasificación estructurada de objetivos SMART. El registro narrativo
de objetivos permanece disponible; tampoco se bloquean SOAP, evaluación del estado
mental, notas de proceso, plan de seguridad, observaciones de dolor o movilidad.
Las funciones cardiológicas actualmente sin interfaz también rechazan edades
menores de 18 años; esto no certifica su aplicabilidad en otros rangos.

El servidor consulta la identidad real del paciente dentro de la organización y
la fecha del turno vinculado a la sesión. Calcula el día en
`America/Argentina/Cordoba`. Una aplicación sin sesión usa el reloj del servidor;
no se acepta la edad enviada por el navegador ni una fecha de creación inventada.
Fecha ausente, imposible o de nacimiento futura impide una nueva clasificación.

Los registros previos siguen visibles como respuestas originales. El historial
usa la fecha de atención, no la fecha de carga; una atención pediátrica no se vuelve
a interpretar porque hoy el paciente sea adulto. El guardado narrativo conserva
exactamente las respuestas previas, incluidas representaciones antiguas y avisos.
Una omisión de herramienta en el guardado SOAP conserva sus columnas históricas.
Cambiar, retirar o sustituir una escala previa exige elegibilidad; los bloqueos y
las enmiendas existentes siguen vigentes. No se sustituye un bloqueo por “sin riesgo”.

## Despliegue

M105 es aditiva: agrega procedencia de la política y un control privado inicialmente
desactivado. Aplicar la migración, desplegar la interfaz y los writers compatibles,
verificar la conservación de narrativas e históricos y, finalmente, habilitar
`enable_instrument_population_policy(text)` con rol de servicio y motivo operativo
sin datos clínicos. La habilitación guarda fecha, usuario de base y motivo; no existe
un método público para desactivarla. No fue activada en producción en este trabajo.

Con la política habilitada, el trigger impide que INSERT/UPDATE directos de
`instrumento_respuesta` omitan la comprobación de población, incluso con una política
RLS permisiva. Los registros históricos sin cambios pueden conservarse y bloquearse.
El control no descifra `sesion.tool_data_cifrado` dentro de PostgreSQL: ese JSON se
valida en el writer de aplicación. Las autorizaciones directas sobre ciphertext
requieren una futura revisión de permisos o un punto exclusivo de escritura;
M105 no garantiza inspección poblacional de un ciphertext escrito fuera del writer.
La canonización de fórmulas de un INSERT directo tampoco se prueba descifrando la
base: el cálculo canónico sigue siendo responsabilidad del writer.

## Evidencia local

`tests/unit/instrument-population.test.ts` ejecuta writers y componentes reales con
transporte y hooks sintéticos: edades 12, 14, 16, 17, adulto, DOB ausente/inválida,
fecha histórica, cumpleaños Córdoba, manipulación del cliente, errores sanitizados,
conservación exacta de respuestas y narrativa de crisis disponible.

`tests/sql/M105_instrument_population.spec.sql` usa una transacción que se revierte:
INSERT autenticado con RLS permisiva, habilitación reservada a servicio, población,
históricos y fecha de atención. Antes de M105 el INSERT pediátrico pasó y la prueba
falló; con el control habilitado se rechaza. Las pruebas comprueban restricciones
de software; no validación clínica ni una sesión real de Supabase Auth.
