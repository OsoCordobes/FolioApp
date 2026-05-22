# Folio · Procedimiento de respuesta a incidentes de seguridad
## v 2026-05-21

Este documento operacionaliza el compromiso público de Folio (Política de
Privacidad §9, Términos §6) de notificar incidentes de seguridad a la AAIP
dentro de las 72 horas (Ley 25.326 art. 17 bis, modif. Ley 27.699 / Conv. 108+
adherida por Argentina).

Está dirigido a:
- On-call engineering
- Owner / Director (decisor legal del incidente)
- Counsel externo (privacidad)

---

## 1. Definiciones

| Término | Definición |
|---|---|
| **Incidente** | Cualquier evento que afecte la confidencialidad, integridad o disponibilidad de datos personales o datos de salud tratados por Folio. |
| **Incidente notificable** | Incidente que implique un riesgo para los derechos del titular (acceso no autorizado a PII/PHI, exfiltración, modificación o destrucción no autorizada). |
| **Titular** | Persona física a la que pertenecen los datos personales (profesional o paciente). |
| **AAIP** | Agencia de Acceso a la Información Pública (autoridad de control AR). |
| **MTTD / MTTR** | Mean Time To Detect / Respond. Métricas internas, no requeridas por ley. |

## 2. Matriz de severidad

| Severidad | Definición | Ejemplos | Plazos |
|---|---|---|---|
| **SEV-1 · Crítico** | Brecha confirmada con exposición de PII/PHI de >1 tenant, o pérdida de integridad del audit log, o key encryption comprometida. | Volcado de DB filtrado, `FOLIO_ENC_KEY` en commit público, RLS bypass replicable, ransomware en Supabase. | Detección → war room en 30 min. AAIP <72 h. Titulares <7 días. |
| **SEV-2 · Alto** | Vector de ataque crítico sin evidencia de exfiltración, o exposición de un solo tenant, o secret en logs no rotado. | RLS policy ausente detectada en producción, token de Resend en Sentry, intento exitoso de credential stuffing en una cuenta. | Detección → triage en 2 h. Notificación AAIP solo si hay exfiltración o riesgo material. |
| **SEV-3 · Medio** | Vulnerabilidad sin explotación, o exposición sin PII (ej. metadatos públicos). | XSS reflejado en página pública sin sesión, rate-limit elusion, fuga de IDs internos sin PII. | Triage en 1 día hábil. Patch en ventana ordinaria. |
| **SEV-4 · Bajo** | Hardening / mejora preventiva. | CSP perdida en respuesta no-HTML, depredecated header. | Triage en sprint. |

La severidad se ESCALA si nuevos hechos emergen, NUNCA se baja sin escrito.

## 3. Roles

- **On-call (engineering):** primer responder. Triage técnico, contención, evidencia.
- **Incident Commander (IC):** Owner o quien designe. Decide severidad y go/no-go de notificación. Coordina comunicaciones.
- **Counsel externo:** valida el texto de notificación AAIP y a titulares.
- **Comunicación externa:** Owner (a profesionales) y privacy@folio.app (a titulares).

## 4. Detección · señales que disparan el procedimiento

- Sentry alert: error rate > 10/min en endpoint que toca PII/PHI.
- PostHog dashboard "Anomalous reads": p95 lectura de paciente_identidad > 3σ del baseline horario.
- Supabase audit (auth.audit_log_entries): >5 logins fallidos / 1 min para una cuenta.
- Reporte externo: email a security@folio.app, mensaje en redes, comunicación del proveedor (Supabase / Vercel) o usuario.
- Health check `/api/health` retornando 503 sostenido > 5 min.
- Falla de un `audit_log_trigger` (audit_log gap > 1 h sin escritura cuando hay tráfico).

## 5. Runbook

### 5.1 Triage (T+0 — T+30 min)

1. On-call abre canal Slack #incident-<YYYY-MM-DD>-<short-id>.
2. On-call captura evidencia INICIAL: timestamp, URL/endpoint, IP, request id, screenshot. Si hay credenciales involucradas, **no las pegues en Slack** — referencialas por hash.
3. On-call asigna severidad provisoria y notifica al IC.
4. IC convoca war room para SEV-1/SEV-2 dentro de 30 min.
5. Si hay riesgo activo (atacante con acceso): **contener primero**.
   - SEV-1 keys: rotar `FOLIO_ENC_KEY`, `FOLIO_ENC_HMAC_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Forzar logout global vía Supabase Auth invalidar JWT secret.
   - Acceso no autorizado a cuenta: revocar sessions del profile (`auth.sessions` DELETE) + reset password.

### 5.2 Análisis (T+30 min — T+24 h)

1. Reconstruir el incidente desde `audit_log` y logs de Vercel/Supabase. Identificar:
   - Vector de entrada (RLS bypass, leaked secret, credential stuffing, supply chain).
   - Categorías y cantidad de datos afectados (PII / PHI / metadatos).
   - Lista de titulares afectados.
2. IC determina si es **notificable** según matriz §2.
3. Counsel revisa el texto de notificación.

### 5.3 Notificación a AAIP (SEV-1, eventualmente SEV-2)

Plazo: **72 horas** desde T+0 (detección).

Canal:
- Formulario oficial: https://www.argentina.gob.ar/aaip/datospersonales (módulo "Notificación de incidentes")
- Email de respaldo: datospersonales@aaip.gob.ar

Contenido mínimo (Disp. AAIP 47/2018 + 332/2020):
1. Identificación del responsable (Folio + CUIT).
2. Descripción del incidente (qué pasó, cuándo se detectó).
3. Categorías y volumen de datos afectados.
4. Posibles consecuencias para los titulares.
5. Medidas adoptadas (contención, remediación, mitigación).
6. Punto de contacto: privacidad@folio.app.

Plantilla de notificación: ver `docs/templates/aaip-breach-notification.md` (a crear cuando ocurra el primer ejercicio o incidente real).

### 5.4 Notificación a titulares

Plazo: **sin dilación indebida** cuando el riesgo sea alto.

Canal: email transaccional vía Resend, asunto "Aviso de seguridad — acción recomendada". Sin tracking pixels, sin links a campaña.

Contenido:
- Qué pasó, qué datos suyos pudieron verse afectados.
- Qué medidas tomamos.
- Qué puede hacer el titular (cambiar contraseña, revisar sesiones, etc.).
- Contacto y referencia al expediente AAIP si aplica.

Si la base de afectados es >1000 personas o no es identificable individualmente, publicar un aviso público en /aviso-seguridad además del email.

### 5.5 Cierre y post-mortem (T+7 días — T+30 días)

1. Post-mortem blameless dentro de 7 días.
2. Plan de remediación con dueños y fechas. Cambios estructurales (RLS, key management, observability) priorizados.
3. Actualización de este documento si el incidente reveló un gap del runbook.
4. Reporte interno a auditoría legal anual.

## 6. Contenedores de evidencia

| Tipo | Ubicación | Retención |
|---|---|---|
| Logs aplicación | Vercel logs + Sentry | 30 días Vercel, 90 días Sentry. Para incidentes activos, exportar y archivar en bucket privado. |
| Audit log | `public.audit_log` particionado | 10 años (Ley 26.529). |
| Snapshots Supabase | Supabase dashboard | 7 días Free / 30 días Pro. Forzar snapshot manual al detectar incidente. |
| Comunicaciones Slack | Canal #incident-* | 1 año, luego export a Drive. |
| Notificación AAIP | Bucket `incidentes/aaip/<YYYY>/<expediente>` | Indefinida (evidencia legal). |

## 7. Drills

Cada semestre (junio y diciembre), el IC corre un drill teórico con un escenario sintético. Mide:
- Tiempo desde alerta sintética a apertura del canal.
- Tiempo desde triage a propuesta de notificación.
- Completitud del texto AAIP (revisión por counsel).

Resultado se anexa a este documento como `drills/YYYY-MM.md`.

## 8. Contactos

| Quién | Cuándo | Cómo |
|---|---|---|
| On-call engineering | Cualquier alerta | PagerDuty (rotación) |
| Incident Commander | SEV-1 / SEV-2 | Owner directo + Slack |
| Counsel externo | Antes de notificar AAIP | (a completar pre-lanzamiento) |
| Soporte Supabase | Si vector involucra DB host | https://supabase.help (Pro plan: 1 h SLA) |
| Soporte Vercel | Si vector involucra hosting | https://vercel.com/help |
| AAIP | Notificación obligatoria SEV-1 | https://www.argentina.gob.ar/aaip · datospersonales@aaip.gob.ar |

## 9. Apéndice · qué NO hacer

- **No** comunicar el incidente externamente (LinkedIn, X, prensa) antes de la notificación a AAIP y a titulares afectados.
- **No** eliminar evidencia para "limpiar" la base. Mantener una copia forense incluso si se restaura desde backup.
- **No** prometer compensación sin counsel — puede generar pasivo legal innecesario.
- **No** rotar keys sin coordinar con on-call: rotación mal hecha puede dejar la app sin acceso a los datos cifrados.
- **No** bajar la severidad por presión comercial. Documentar siempre con escrito.
