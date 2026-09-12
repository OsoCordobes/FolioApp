# Registro de iteraciones de confiabilidad

## 12 de septiembre de 2026 — inicio

- Goal creada y activa; especificación: `docs/LAUNCH-RELIABILITY.md`.
- Copia `folio-reliability`, rama `codex/launch-reliability`, base 11f0206. Ninguna edición en copias ajenas.
- Se revisaron instrucciones del repositorio, tarea visual y evidencia previa. El trabajo M106/M117/M119 se reutiliza; no se reimplementa sin defecto reproducible.
- Dos auditorías independientes leyeron guardado/creación y cobros. Encontraron cierre/pago parcial, éxito sin filas en Finanzas y una columna inexistente en el ensayo E2E.
- Base unitaria: 2111/2111, sin omisiones. Comprobación de tipos en ejecución.
- Se detectó que 4410 pertenece a la vista visual. Los ensayos propios deberán usar otro puerto y nunca reutilizar ese servidor.
- Docker Desktop detenido; PostgreSQL 16 de ensayo disponible. El recorrido con Supabase real sigue sin comprobar.

### Decisiones de alcance

- Ruling: usar 11f0206 como base fija porque ya contiene protecciones necesarias de identidad, agenda y clínica — evita duplicarlas — implica revisar e integrar sus migraciones y diferencias con master antes de publicar.
- Ruling: no tomar los tests unitarios existentes como evidencia de que el cobro se persistió — se agregarán escenarios de cero filas y fallo intermedio — cuesta pruebas específicas adicionales, sin cambiar reglas de negocio por suposición.

### Próximo trabajo

1. Reproducir y corregir la confirmación sin filas en `marcarPagoCobradoAction`, conservando la idempotencia sólo si una nueva lectura autorizada confirma PAGADO.
2. Corregir/preparar el ensayo clínico: conteo por JOIN y puerto 4420 dedicado, manteniendo los rechazos de destinos externos, puertos de desarrollo y DB con datos ajenos.
3. Reproducir cierre sin pago y diseñar la corrección teniendo en cuenta el cierre clínico M106, permisos y pagos ya existentes.
4. Preparar evidencia SQL real en una base nueva propia del servidor local 55439.
