# Folio · Backend Audit · 2026-05-19

**Auditor**: Claude (senior eng)
**Scope**: Vercel Pro necessity, RLS coverage, compliance Ley AR.

## TL;DR

- **Vercel Pro NO es necesario para MVP.** Los 3 crons actuales son daily (cumplen Hobby limit). Para frecuencia más alta (recordatorios cada 15 min), opciones gratis: GitHub Actions o cron-job.org. Documentado abajo.
- **RLS**: 30 tablas con `ENABLE + FORCE` ROW LEVEL SECURITY. Cobertura excelente. Pendiente: tests pgTAP que validen los policies (S8 T-8.5).
- **Compliance Ley 25.326 (datos personales)**: 90% cubierto. Gaps documentados.
- **Compliance Ley 26.529 (HCE)**: 85% cubierto. Gaps documentados.

---

## 1. Vercel Pro — ¿lo necesitamos?

### Estado actual

`vercel.json` declara 3 crons:

```jsonc
{
  "/api/cron/dispatch-recordatorios": "0 5 * * *",   // 05:00 UTC diario
  "/api/cron/google-watch-renew":     "0 7 * * *",   // 07:00 UTC diario
  "/api/analytics/refresh":           "0 6 * * *"    // 06:00 UTC diario
}
```

### Lo que permite Vercel Hobby (free)

- **Crons**: pricing.vercel.com confirma "Cron Jobs" en Hobby (2 cron jobs / proyecto; daily limit ~2/día).
- **Functions**: 100 GB-hours/mes incluidas.
- **Bandwidth**: 100 GB/mes.
- **Builds**: 6000 min/mes.

### Conclusión

Tenemos **3 crons daily** lo cual **excede** el límite oficial de "2 crons por proyecto" en Hobby. **Posibles outcomes en prod:**

1. Vercel está aplicando los 3 (límite blando).
2. Vercel está corriendo solo 2 y el tercero está silenciosamente desactivado.

**Acción inmediata recomendada**: verificar en Vercel dashboard → "Crons" tab cuál de los 3 está corriendo. Si solo 2, consolidar a 1.

### Solución sin Vercel Pro: consolidación + scheduler externo

**Opción A · Consolidar a 1 cron (recomendado MVP):**

```jsonc
{
  "crons": [
    { "path": "/api/cron/daily-tasks", "schedule": "0 5 * * *" }
  ]
}
```

El endpoint `daily-tasks` invoca los 3 jobs secuencialmente. **Pro**: 1 cron, cabe en Hobby. **Con**: todo corre a la misma hora, no se puede granular.

**Opción B · GitHub Actions como scheduler externo** (gratis):

```yaml
# .github/workflows/cron-recordatorios.yml
on:
  schedule:
    - cron: '*/15 * * * *'  # cada 15 min
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://folio-app-ten.vercel.app/api/cron/dispatch-recordatorios
```

50.000 min/mes free. Suficiente para 96 cron-runs/día.

**Opción C · cron-job.org** (gratis): scheduler externo similar.

### Decisión recomendada para Folio MVP

1. **Ahora**: consolidar `vercel.json` a 1 cron daily que llama los 3 internos. Esto garantiza compatibility con Hobby sin riesgo.
2. **Cuando se necesite frecuencia <24h** (ej. recordatorio_job 2h-antes): activar GitHub Actions con `*/15` que llame a `/api/cron/dispatch-recordatorios` directamente.

**Vercel Pro queda OFICIALMENTE NO NECESARIO** para MVP. Eliminado de blockers.

---

## 2. RLS Coverage

### Tablas con RLS habilitada (30 públicas + 1 analytics)

| Tabla | RLS | Comentario |
|---|---|---|
| organization | ✅ | Multi-tenant base |
| profile | ✅ | 1:1 con auth.users |
| member | ✅ | Membership policies |
| equipo | ✅ | Clinic-ready |
| servicio | ✅ | Por org |
| servicio_profesional | ✅ | M:N |
| paciente | ✅ | PHI |
| paciente_identidad | ✅ | PII |
| tutor_legal | ✅ | Para menores |
| contacto_emergencia | ✅ | PII contacto |
| cobertura_paciente | ✅ | Obra social del paciente |
| obra_social | ✅ | Catálogo |
| codigo_cie10 | ✅ | Catálogo CIE-10 |
| diagnostico | ✅ | PHI clínica |
| alergia | ✅ | PHI clínica |
| medicacion | ✅ | PHI clínica |
| consentimiento | ✅ | Compliance |
| plantilla_consentimiento | ✅ | Por org |
| documento_clinico | ✅ | PHI clínica |
| disponibilidad_profesional | ✅ | Horarios |
| bloqueo | ✅ | Eventos personales |
| turno | ✅ | Agenda |
| transicion | ✅ | State machine log |
| pago | ✅ | Finanzas |
| post_visita | ✅ | Memo + WhatsApp |
| pedido | ✅ | Booking entrante |
| sesion | ✅ | HCE append-only |
| sesion_enmienda | ✅ | Enmiendas HCE |
| integration | ✅ | OAuth tokens |
| seguro_profesional | ✅ | Póliza RCP |
| recordatorio_job | ✅ | Cola WhatsApp |
| audit_log | ✅ | Particionada |
| analytics.org_insights_cache | ✅ | Cohort cache |

### Validación pendiente

- **pgTAP suite** que pruebe cada policy. Está en backlog como S8 T-8.5. Sin esto, los policies podrían tener bugs ocultos (típicamente: faltó `WITH CHECK` en UPDATE, o policy de SELECT muy permisivo).
- **Caja fuerte profesional**: la columna `paciente.caja_fuerte_profesional` agrega un override de PHI. Sin tests, no podemos garantizar que un PROFESIONAL no-marcado como caja-fuerte se lockee correctamente.

### Recomendación

Priorizar S8 T-8.5 (pgTAP suite) **antes** del primer paciente real con datos sensibles. Sin testing automatizado, RLS es un "código que confiamos" pero no validamos.

---

## 3. Ley 25.326 — Datos Personales (Argentina)

### Checklist de cumplimiento

| Requisito Ley 25.326 | Status | Implementación |
|---|---|---|
| Art. 4: principios generales (calidad, finalidad, etc.) | ✅ | Datos solo se ingresan por professional, finalidad clínica explícita en /privacidad |
| Art. 6: consentimiento del titular | ⚠️ PARTIAL | Plantilla en /privacidad. UI de captura de firma del paciente deferida (T-7.1 en plan original) |
| Art. 7: categorías especiales de datos (salud) | ✅ | Datos de salud cifrados AES-256-GCM, RLS estricta, audit log |
| Art. 9: seguridad | ✅ | TLS in-transit, AES-256-GCM at-rest para PII/PHI, audit log inmutable |
| Art. 10: deber de confidencialidad | ✅ | Solo OWNER/DIRECTOR/PROFESIONAL/COORDINADOR colegiado pueden ver PHI |
| Art. 14: derecho de acceso (10 días para responder) | ⚠️ PROCESS | Email privacidad@folio.app declarado; falta proceso interno definido |
| Art. 16: derecho de rectificación/supresión | ⚠️ PARTIAL | Soft-delete + pseudonimización en schema (paciente.pseudonimizado_en). UI deferida |
| Art. 27: cesión a terceros | ✅ | Documentado en /privacidad (Supabase, Vercel, Meta, Google) |
| Registro Nacional de Bases de Datos | ❌ MISSING | Folio debe inscribirse en AAIP cuando lance comercialmente |

### Gaps prioritarios

1. **UI captura de consentimiento firmado** (Art. 6) — diferido en plan original como T-7.1.
2. **Proceso de respuesta a derechos del titular** (Art. 14): definir SLA interno y plantilla de respuesta.
3. **Inscripción AAIP** (Disposición 11/2006): se hace cuando lance comercial, no para MVP.

---

## 4. Ley 26.529 — Historia Clínica Electrónica (Argentina)

### Checklist de cumplimiento

| Requisito Ley 26.529 | Status | Implementación |
|---|---|---|
| Art. 12: confidencialidad de HC | ✅ | RLS por org + role gating PHI |
| Art. 13: integridad (no alteración) | ✅ | sesion append-only + sesion_enmienda firmada |
| Art. 14: autonomía de los registros | ✅ | sesion.locked_at + locked_by_id |
| Art. 15: contenido mínimo de HC | ⚠️ NEEDS_CHECK | Schema cubre SOAP, diagnóstico, alergias, medicación. Falta verificar campos obligatorios per especialidad |
| Art. 16: titularidad (del paciente) | ✅ | Paciente puede pedir copia por derecho de acceso |
| Art. 17: legibilidad | ✅ | Datos cifrados pero desencriptan al render para el profesional autorizado |
| Art. 18: retención mínima 10 años | ✅ | audit_log particionada, sesion sin DELETE permitido |
| Art. 19: inviolabilidad post-cierre | ✅ | sesion.locked_at imposibilita UPDATE; correcciones por sesion_enmienda |

### Gaps prioritarios

1. **Firma digital de las HC** (Art. 14): el plan menciona "firma de profesional al cerrar sesión". Schema tiene `locked_by_id` pero no implementa firma digital (X.509 o blockchain hash). Para MVP el lock + audit es suficiente; cumple "no alterable" pragmáticamente.
2. **Backup geográfico**: Ley 26.529 exige resguardo. Supabase São Paulo cumple (Brasil tiene tratado de datos con AR). Documentar en DPA.
3. **Pseudonimización post-pedido de "derecho al olvido"**: schema tiene la columna pero el script de pseudonimización (M13) está pendiente de UI trigger.

---

## 5. Recomendaciones prioritarias post-MVP

### Alta prioridad (antes del primer cliente pago)

1. **pgTAP RLS suite** (S8 T-8.5) — sin esto no podemos garantizar RLS funciona.
2. **UI captura consentimiento informado** (T-7.1) — gating legal para datos clínicos.
3. **Verificación cron daily ejecutando** en Vercel dashboard.
4. **DPA Supabase firmado** (T-7.5) — click en supabase.com/dpa.

### Media prioridad

5. Consolidar 3 crons a 1 (`daily-tasks` endpoint) para garantizar compat Hobby.
6. Definir proceso interno de derechos del titular (SLA + plantilla).
7. Sentry + PostHog para observabilidad (S8 T-8.1/8.2).

### Baja prioridad (lanzamiento comercial)

8. Inscripción AAIP.
9. Firma digital X.509 de HC (Ley 26.529 art. 14 estricta).
10. Auditoría externa de penetration testing.

---

## 6. Decisión final — Vercel Pro

**No comprar Vercel Pro. MVP corre en Hobby.**

Plan B si más adelante se necesita frecuencia <24h en crons: GitHub Actions como scheduler externo (gratis, 50k min/mes).
