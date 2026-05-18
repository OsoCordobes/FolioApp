# Folio · seeds

Datos base que se cargan UNA SOLA VEZ al inicializar la DB.

## Orden de carga

Los archivos están numerados y se aplican en orden:

```
01_obras_sociales_ar.sql       — ~25 obras sociales y prepagas argentinas
02_cie10_starter.sql            — ~80 códigos CIE-10 (95% uso quiropraxia/general)
03_plantillas_consentimiento.sql — 5 plantillas legales globales
```

## Aplicar seeds

```bash
# Con Supabase local
supabase db reset                # aplica migrations + seeds automáticamente
supabase migration up

# Manualmente
for f in supabase/seed/[0-9]*.sql; do
  echo "▶ $f"
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

## Cuándo agregar más

- **CIE-10 completo (~14k filas)**: F11 polish. Scrape oficial OMS Spanish edition.
- **Obras sociales completas (~300 filas)**: F11 si los usuarios reportan que falta su OS. Source: padrón Superintendencia de Servicios de Salud.
- **Geo regions AR**: M15 (analytics). Mapping ciudad → gran_area → provincia → region_nacional para k-anonymity cascada.

## NO incluir en seeds

- Datos de prueba (pacientes, turnos, etc.) — esos se generan en pgTAP tests o fixtures de Playwright.
- Plantillas de consentimiento custom de cada consultorio — esas las crean OWNER/DIRECTOR vía /configuracion.
- Tokens de OAuth — esos se generan en F5/F6 cuando cada consultorio conecta sus integraciones.
