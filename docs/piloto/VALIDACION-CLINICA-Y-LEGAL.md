# Validación para el piloto de Folio en Córdoba

Estado: **pendiente de aprobación profesional y jurídica**. Preparado el 8 de
septiembre de 2026. Este expediente contiene los casos y decisiones que deben
revisarse antes de atender pacientes reales; las pruebas de software no firman
estas aprobaciones. No incorpora datos de pacientes ni matrículas reales.

## Responsables y habilitación

Completar por cada uno de los tres profesionales: nombre, título exacto,
institución emisora, matrícula y jurisdicción, estado verificado, especialidad
anunciada, lugar de atención y edades que acepta. Registrar fuente y fecha de
la verificación, además de quién la realizó. El [buscador nacional REFEPS](https://www.argentina.gob.ar/salud/buscador-nacional-de-profesionales-de-la-salud)
permite contrastar información remitida por colegios y autoridades sanitarias;
las dudas deben resolverse con el organismo que administra la matrícula.

Para quiropraxia falta conocer el título real del socio y el encuadre de su
actividad. El nombre comercial de una práctica no acredita su habilitación.
La [Ley provincial 6.222](https://www.argentina.gob.ar/normativa/provincial/ley-6222-123456789-0abc-defg-222-6000ovorpyel/actualizacion)
es una referencia de partida del ejercicio sanitario en Córdoba; verificar las
normas específicas posteriores y el alcance correspondiente al título efectivo.
No inferir de esa ley una autorización general ni trasladar restricciones de una
profesión a otra.

El titular y su socio deben identificar quién contratará y facturará Folio:
nombre o razón social, CUIT, domicilio, contacto público de soporte y privacidad,
responsable técnico, sustituto y horario de atención. Esos datos están pendientes;
no completar contratos con identidades supuestas ni publicarlos como aprobados.

## Casos sintéticos que deben completar los profesionales

Usar una organización aislada por especialidad, comunicaciones externas bloqueadas
y la versión exacta que se pretende lanzar. Repetir los casos en escritorio y
móvil. El CSV adjunto sirve para registrar el resultado y la aprobación; no
reemplazar las respuestas por el resultado de una prueba automatizada.

| Caso | Recorrido | Criterio de aceptación |
|---|---|---|
| Adulto | Alta, reserva o llegada sin turno, atención, cierre, cobro y consulta posterior | El profesional comprende cada estado y encuentra todo lo que guardó. |
| Menor de 13 | Identidad propia, acompañante y decisión de consentimiento documentada | El contacto familiar no se convierte en titular de la ficha; las dudas quedan explícitas. |
| Adolescente de 13–15 | Evaluación por acto y privacidad frente a representante | No se decide sólo por edad; se registra el fundamento y la participación que corresponda. |
| Adolescente de 16–17 | Decisiones sobre su cuerpo y permisos separados del acompañante | La representación no concede automáticamente acceso a notas ni sustituye la decisión documentada. |
| Hermanos | Dos fichas con el mismo teléfono y correo familiar | Permanecen separados después de importar, reservar, firmar y acceder al portal. |
| Representación | Vencimiento, revocación y autorización limitada a agenda | Ningún permiso vencido permite firma o entrega clínica; la incertidumbre se deriva a revisión humana. |
| Historia extensa | Más de diez sesiones, enmiendas, documentos y restauración | Exportación completa, original y correcciones identificables; ningún error se presenta como historia vacía. |
| Conexión y concurrencia | Dos pestañas, respuesta perdida y segundo guardado | El borrador no se pierde; el conflicto se explica; cierre y cobro no se anuncian sin confirmación. |

La autonomía progresiva requiere evaluación contextual: el artículo 26 contempla
aptitud y madurez, supuestos específicos entre 13 y 16 años y el tratamiento de
mayores de 16 respecto del cuidado del propio cuerpo. No programar una regla de
firma universal para toda persona menor de 18. Fuente: [Código Civil y Comercial, artículo 26](https://www.argentina.gob.ar/normativa/nacional/235975/texto).

Para psicología, revisar con su profesional las [recomendaciones del Colegio de Psicólogos de Córdoba](https://cppc.org.ar/wp-content/uploads/2025/09/Recomendaciones-para-la-implementacion-del-Consentimiento-Informado-1.pdf).
Ese material aporta orientación profesional; no prueba automáticamente el
protocolo de cardiología o quiropraxia.

Cada instrumento necesita una ficha aprobada con nombre y versión, licencia o
condiciones de uso, población y edades validadas, unidades, preguntas, cálculo,
fuente primaria, interpretación, límites y responsable de aprobación. Las pruebas
deben contrastar resultados conocidos y extremos. El bloqueo provisional de
instrumentos pediátricos y la retirada de la clasificación cardiovascular
simplificada son medidas de contención: no certifican los instrumentos restantes.

## Historia clínica, derechos y baja

El paciente es titular de su historia; la ley prevé la entrega de copia en 48
horas, con tratamiento de urgencias, y exige integridad y recuperabilidad del
soporte informático. La custodia comprende un mínimo de diez años desde la
última actuación, según su artículo 18. No excluir automáticamente notas por
considerarlas propiedad del profesional. Fuente: [Ley 26.529 actualizada](https://www.argentina.gob.ar/normativa/nacional/ley-26529-160432/actualizacion).

El procedimiento propuesto registra recepción y plazo de la solicitud, acredita
identidad y representación, determina alcance con el responsable clínico,
prepara copia completa, revisa datos de terceros, autentica la entrega y deja
constancia de recepción. Una suspensión comercial no debe impedir ese circuito.
El cierre de la cuenta requiere separar datos de acceso, obligaciones clínicas,
contables y del tratamiento por encargo. No borrar ni pseudonimizar historias
automáticamente como respuesta universal a una solicitud.

La normativa de datos personales distingue obligaciones de seguridad,
confidencialidad y tratamiento por cuenta de terceros. El contrato debe precisar
instrucciones, finalidad, personas autorizadas, proveedores, incidentes, retorno
y disposición de datos al finalizar el servicio. Revisar también el registro
que corresponda como responsable de bases. Fuente: [Ley 25.326, artículos 8–10 y 21–25](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion).

## Proveedores y transferencias

Inventariar por separado base/Auth/Storage, procesamiento de la aplicación,
pagos, correo, calendario, seguridad y analítica: entidad contractual, países,
datos tratados, finalidad, subencargados, retención, mecanismos de exportación
y contrato vigente. Brasil no figura en la lista de destinos adecuados publicada
por AAIP consultada para este expediente. Seleccionar y documentar un mecanismo
aplicable a cada transferencia; la cercanía geográfica o una cláusula europea
del proveedor no demuestran por sí solas la cobertura argentina. Fuente:
[AAIP, transferencias internacionales y modelos](https://www.argentina.gob.ar/transferencias-internacionales).

Las [cláusulas aprobadas por Resolución 198/2023](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-198-2023-391538/texto)
ofrecen material para la revisión del contrato correspondiente. Conservar la
versión aceptada y sus anexos concretos; no marcar una transferencia como
resuelta solamente por haber descargado un modelo.

## Firma de la habilitación del piloto

Registrar por cada aprobación: alcance, versión de Folio, fecha, evidencia,
responsable, restricciones y próxima revisión. Un resultado parcial mantiene
cerrada esa prestación. Antes del piloto se requiere:

- Habilitación y protocolo de cada profesional, incluidos menores.
- Identificación del operador, contratos, privacidad, proveedores y facturación.
- Medio de acceso y entrega de historias durante suspensión o baja.
- Recuperación ensayada, custodia externa de la clave y responsables de soporte.
- Corrección de afirmaciones heredadas sobre copias de 30 días, auditoría de
  toda lectura, firma digital certificada y conservación garantizada que no
  estén demostradas por la operación real.

La aprobación habilita un piloto de 14 días, con al menos cinco jornadas por
profesional. No acredita todavía capacidad sostenida para 200 profesionales.
