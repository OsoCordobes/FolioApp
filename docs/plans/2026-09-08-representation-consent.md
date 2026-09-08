# D1: representación y consentimiento por acto

Scope confirmado con coordinación: consentimientos y representantes; instrumentos
por edad y adjuntos M102 tienen ownership separado. No producción.

| Rol de la persona | Qué acredita | Qué no concede |
|---|---|---|
| Paciente | Identidad propia y decisión documentada por acto | Su contacto compartido no identifica a familiares |
| Contacto de emergencia | Persona a quien llamar | Firma, representación o acceso al portal |
| Representante pendiente | Datos aportados por verificar | Firma ni acceso delegado |
| Representante verificado | Identidad, vínculo/evidencia, período, restricciones y alcance específico | Propiedad de la cuenta del paciente ni narrativa clínica automática |
| Representante revocado/vencido | Evidencia histórica | Nuevas acciones |

| Evaluación profesional | Registro |
|---|---|
| Pendiente | Fundamento/participación y tarea por revisar, sin firma atribuida |
| Autónomo | Firma del paciente |
| Asistido | Firma del paciente y del representante vigente; ninguna sustituye a la otra |
| Representado | Firma del representante y participación o razón de imposibilidad del paciente |

Edad, madurez, comprensión, acto, riesgos, conflictos y restricciones se evalúan
profesionalmente. No regla universal de tutor para menores de 18 ni por tipo de
plantilla. Portal sólo firma evaluaciones autónomas previamente registradas para
esa ficha/plantilla y todavía vigentes. La narrativa clínica sigue su proceso de
entrega revisada; permiso de agenda no equivale a acceso clínico.

Implementación: M103 aditiva conserva `tutor_legal` y consentimientos previos,
incorpora estados, vigencia explícita y auditoría; evaluación inmutable por acto;
texto/version congelados; evidencia individual de cada participante. Nuevas firmas
se validan en servidor y SQL, sin atribución por omisión ni errores de lookup.
Los registros anteriores mantienen datos originales con evidencia pendiente de
revisión. La atención clínica puede registrarse aunque el consentimiento esté
pendiente; no se fabrican firmas ni certificaciones de capacidad.

Validación pendiente por profesionales y asesoría jurídica de Córdoba antes de
piloto. Referencias: CCyC art.26 y Ley26.529 texto actualizado, no validación legal
automática ni firma digital certificada.
