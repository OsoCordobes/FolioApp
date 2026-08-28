# Auditoría end-to-end · post-incidente `.env.local` (2026-08-28)

Disparador: el 2026-08-13 `vercel integration add upstash/upstash-kv` sobrescribió
`.env.local` con el entorno de **Development** y se llevó la única copia legible de
`FOLIO_ENC_KEY` y `FOLIO_ENC_HMAC_KEY`. Este documento audita **qué daño real hubo**
y **si la rotación descripta en `docs/ROTACION-CLAVES.md` se puede correr hoy**.

Respuesta corta: el código está intacto; la rotación **no** se puede arrancar todavía.

---

## 1 · Daño real

### 1.1 Código: cero

| Verificación | Resultado |
|---|---|
| Dependencia agregada por el integration (`@upstash/redis`, `@vercel/kv`) | **ninguna** — `package.json` sin cambios; el rate limiting usa la REST API por `fetch` |
| Archivos fuente tocados | **ninguno** |
| Cambio visible en el repo | una línea `.env*.local` al final de `.gitignore` |
| `pnpm typecheck` | limpio |
| `pnpm lint` | limpio |
| `pnpm test:unit` | **1563/1563** con las keys presentes |

Sobre el `.gitignore`: `.env*.local` es redundante (`.env*` ya cubría el caso) y
**no** rompe la excepción `!.env.local.example` — el patrón exige terminar en
`.local` y el ejemplo termina en `.example`. Verificado: el archivo sigue trackeado.

### 1.2 Secretos en git: limpio

- `.env.local` / `.env` **nunca** fueron commiteados (`git log --all --diff-filter=A`).
- Cero literales de key, service-role o JWT (`eyJ…`) en archivos trackeados.

### 1.3 El suite en rojo es un falso positivo

Un checkout limpio da **37 tests fallando**, todos de crypto. No es una regresión:
esos tests leen `FOLIO_ENC_KEY` / `FOLIO_ENC_HMAC_KEY` del ambiente y no se
auto-proveen keys (a diferencia de `crypto-rotacion.test.ts`, que sí lo hace).

Con **cualquier** par de keys random en el ambiente: **1563/1563 verde**. O sea que
los tests no dependen de los valores viejos — un `.env.local` nuevo con keys
generadas al momento restaura el entorno local por completo.

CI no se vio afectado: `.github/workflows/app-ci.yml` inyecta keys dummy.

### 1.4 Producción: sin impacto

El runtime de Vercel tiene las keys inyectadas. La app sigue leyendo y escribiendo
normalmente. Lo que se perdió no es la key, es **la posibilidad de leerla**.

### 1.5 La pérdida secundaria que no está documentada

`.env.local` no tenía sólo las dos keys de cifrado: tenía **47 variables**, y todas
quedaron con el valor de **Development**. Las de mayor riesgo operativo:

- `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL`, `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Todos los `scripts/*.mjs` se conectan por esas variables.** Entre ellos
`backup-logical.mjs` — que es el **Paso 0** de la rotación. Correr el backup
pre-rotación contra la base equivocada es exactamente el modo de fallo que el
Paso 0 existe para prevenir.

No se puede resolver desde el repo: hay que **verificar a mano** a qué proyecto
apunta hoy cada URL antes de correr cualquier script.

---

## 2 · Bloqueantes de la rotación

### B1 · Los lectores de blind index siguen en `.eq()`

`blindIndexCandidatos()` y `blindIndexPhoneCandidatos()` existen, están testeados
y **no los usa nadie**. Igual que `rotacionEnCurso()`. Son código muerto hoy.

Con `FOLIO_ENC_HMAC_KEY_NEXT` seteada se **escribe** con la key nueva y se lee con
`.eq(hashNuevo)`: toda fila todavía no rehasheada deja de encontrarse.

| Sitio | Línea | Qué se rompe |
|---|---|---|
| `lib/db/pacientes.ts` | 212, 229 | buscador de pacientes → 0 resultados |
| `lib/db/pedidos.ts` | 258 | promoción de pedido → paciente |
| `lib/portal/link-actions.ts` | 208-210 | vinculación de cuenta del portal |
| `app/(app)/configuracion/importar-pacientes/actions.ts` | 178-187 | dedupe del import CSV |

> El checklist de `ROTACION-CLAVES.md` lista **tres**; la cuarta (import CSV) falta.
> Es la más fácil de arreglar: ya consulta con `.in()` sobre un set de candidatos
> (salted + legacy sin sal). Sólo hay que sumar los candidatos por key.

El fallback legacy de `buscarPaciente` **no ayuda**: es para la transición del
*salt* per-tenant y computa el hash con la key de escritura, o sea la nueva.

### B2 · El job de re-cifrado no existe — y no tiene dónde correr

Más grave que "falta escribirlo": la key vieja **sólo es legible dentro del runtime
de Vercel**. Todos los scripts del repo son CLI locales que leen
`process.env.FOLIO_ENC_KEY` de `.env.local`, que ya no la tiene y no la va a tener
nunca más.

Consecuencia de diseño, todavía no resuelta en el doc:

- el job **no puede ser un `.mjs`**; tiene que correr dentro de Vercel (route
  autenticada tipo `/api/cron/*` con `CRON_SECRET`, o similar);
- con timeout de función serverless, lo que refuerza el requisito de
  **lotes + checkpoint reanudable** que el doc ya pide;
- `app/api/admin/migrate/route.ts` es el único precedente de una route que abre
  `pg` directo — es el molde a seguir.

### B3 · No hay sonda de cobertura

El Paso 4 pide confirmar que **cero** filas responden a la key vieja. No existe.
Sin eso no hay señal para hacer el swap del Paso 5, y el swap a ciegas deja datos
ilegibles para siempre.

---

## 3 · Hallazgos nuevos de esta auditoría

### H1 · Pacientes duplicados + colisión que traba el rehash — **alto**

`lib/db/pedidos.ts:258`: durante la ventana, el INSERT escribe `telefono_hash` con
la key nueva. El partial UNIQUE de M30 —`(org, telefono_hash) WHERE deleted_at IS
NULL`— **no colisiona** con la fila vieja (hash distinto), así que el `23505` que
el código usa como señal de "ya existe" nunca se dispara y se crea una **identidad
duplicada** para un paciente que ya estaba.

Peor: cuando después el rehash toque la fila vieja, su hash pasa a ser el mismo que
el de la duplicada → `23505` **contra el UNIQUE**, y el job se traba en esa fila.

Es la peor combinación posible: corrupción silenciosa durante la ventana, que
recién se manifiesta como falla dura al final.

### H2 · Una `_NEXT` mal pegada bootea verde y después tira 500 — **alto**

`instrumentation.ts` valida sólo **presencia**, y sólo de las dos keys base. No
valida que sean base64 de 32 bytes, y **no mira las `_NEXT`**.

`loadKey()` tira si el largo no es 32, pero recién en la primera llamada de crypto.
Entonces una `_NEXT` truncada o con un `\n` de más: el deploy queda **verde**, y
después *toda* ruta que toque PHI tira 500. En el Paso 2, que es precisamente el
momento de pegar un valor nuevo a mano.

Arreglo barato y de alto valor: validar largo de las cuatro variables en el boot.

### H3 · `rehash-blind-indexes.mjs` cubre 3 de 6 columnas — **medio**

- Sólo `nombre_hash`, `dni_hash`, `telefono_hash` de `paciente_identidad`.
- **No** `email_hash` (existe desde M70, con índice propio).
- **No** `paciente_cuenta.telefono_hash`.
- Filtra `organization WHERE deleted_at IS NULL` → las orgs archivadas nunca se
  tocan. En un rehash de sal es una omisión; en una rotación de key son filas que
  quedan **ilegibles para siempre**.
- Re-escanea todo en cada corrida (sin checkpoint).

### H4 · `public.hmac_blind()` cae a una key hardcodeada — **bajo (latente)**

`M01:200`. Si el GUC `folio.hmac_key` no está seteado, usa el literal
`'folio-dev-only-key-rotate-on-prod-launch'`.

Hoy es inofensivo: M45 le revoca el execute a `public`/`anon`/`authenticated` y no
tiene callers en la app. Pero es una función `SECURITY DEFINER` que produce blind
indexes con una key de juguete, y en una auditoría de compliance eso se lee mal.
O se dropea, o se la hace fallar fuerte cuando el GUC no está.

### H5 · `/api/health` no mira `FOLIO_ENC_HMAC_KEY` — **bajo**

`instrumentation.ts` la tiene en `required`; `app/api/health/route.ts:70-75` no.
Divergencia menor, pero health es la verificación de los Pasos 2 y 5 — y hoy no
reporta nada sobre el estado de la rotación (`rotacionEnCurso()` está sin usar).

---

## 4 · To-do

### P0 — ahora, independiente de la rotación

- [ ] **Reconstruir `.env.local`** con keys nuevas generadas al momento
      (`openssl rand -base64 32` ×2) y guardarlas en un gestor de contraseñas
      **antes** de pegarlas. Restaura los 37 tests.
- [ ] **Verificar a qué base apunta cada URL** de `.env.local` hoy
      (`POSTGRES_URL_NON_POOLING`, `POSTGRES_URL`, `DATABASE_URL`) y qué proyecto
      es `SUPABASE_SERVICE_ROLE_KEY`. Quedaron en Development. **Ningún script se
      corre antes de esto.**
- [ ] `cp .env.local .env.local.bak` y dejar el `.bak` fuera del repo.
- [ ] Auditar el resto de las 45 variables: cuáles quedaron en Development y
      cuáles hay que reponer para trabajar local.

### P1 — antes de arrancar la ventana (Paso 2)

- [ ] **B1** Migrar los 4 sitios de lectura a `.in(blindIndexCandidatos(...))`.
      Es lo único que hace cierto el "la app sigue andando normalmente" del Paso 2.
- [ ] **H2** Validar largo de las 4 keys en `instrumentation.ts` (boot), no sólo
      presencia.
- [ ] **H1** Decidir la estrategia de dedupe de `pedidos.ts` durante la ventana
      (consultar por candidatos antes del INSERT, y no depender del `23505`).
- [ ] **H5** Agregar `FOLIO_ENC_HMAC_KEY` al `requiredEnv` de health y exponer
      `rotacionEnCurso()` para poder verificar los Pasos 2 y 5.
- [ ] Medir el volumen real (el `SELECT` de `n_live_tup` del Paso 0). Nunca se
      midió; define si el job son minutos u horas.

### P2 — para poder correr los Pasos 3 y 4

- [ ] **B2** Escribir el job de re-cifrado **como route en Vercel**, no como
      script local. Lotes + checkpoint persistido + verificar-antes-de-escribir +
      saltear los placeholders de 1 byte + **sin** filtro por
      `organization.deleted_at`.
- [ ] **B3** Sonda de cobertura: filas que todavía responden a la key vieja,
      por tabla. El Paso 5 no se hace hasta que dé cero.
- [ ] **H3** Ampliar el rehash a las 6 columnas de blind index, sin filtro de org
      archivada y con checkpoint.
- [ ] Decidir explícitamente lo de `audit_log` (§2 del doc de rotación): los
      payloads viejos quedan ilegibles al borrar la key vieja. Es una decisión de
      compliance, no técnica — conviene que quede firmada antes del Paso 5.

### P3 — higiene

- [ ] **H4** Dropear `public.hmac_blind()` o hacerla fallar sin el GUC.
- [ ] Documentar `FOLIO_ENC_KEY_NEXT` / `FOLIO_ENC_HMAC_KEY_NEXT` en
      `.env.local.example` (hoy no figuran).
- [ ] `.env.local.example:22` todavía cita `scripts/rotate-enc-key.ts`, que no
      existe. Es la última referencia sin corregir: `DEPLOYMENT.md`,
      `known-gaps.md`, `retention.md`, `LAUNCH-RUNBOOK.md` y
      `encryption-exceptions.md` ya están marcados.
- [ ] `DEPLOYMENT.md §8` sigue describiendo la rotación manual con downtime y
      manda al inventario incorrecto de `encryption-exceptions.md`. Apuntar a
      `docs/ROTACION-CLAVES.md`.

---

## 5 · Qué NO hay que hacer

- **No** setear las `_NEXT` en producción hasta cerrar P1. El Paso 2 promete que
  la app sigue funcionando, y con los lectores en `.eq()` esa promesa es falsa:
  el buscador se vacía y el portal deja de matchear.
- **No** correr ningún `scripts/*.mjs` hasta verificar a qué base apunta
  `.env.local`.
- **No** tocar `FOLIO_ENC_KEY` (Paso 5) sin la sonda de cobertura en cero.
