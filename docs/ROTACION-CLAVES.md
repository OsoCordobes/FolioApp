# Rotación de `FOLIO_ENC_KEY` y `FOLIO_ENC_HMAC_KEY`

> **Estado: PARCIAL.** El soporte de doble clave está implementado y testeado
> (`lib/crypto.ts`). El job que re-cifra los datos **todavía no existe**. Este
> documento describe el procedimiento completo y marca con **FALTA** cada
> pieza que aún no está. No intentes correr una rotación con lo que hay hoy.

## Por qué existe este documento

El 2026-08-13 se descubrió que `FOLIO_ENC_KEY` y `FOLIO_ENC_HMAC_KEY` están
cargadas en Vercel como `sensitive` — write-only, ni el dashboard ni la API las
devuelven — y que la única copia legible se había perdido. Producción sigue
funcionando porque el runtime las tiene inyectadas, pero **no existe backup
posible de una clave que no se puede leer**: si Vercel las pierde, las 50
columnas cifradas de la base quedan ilegibles para siempre.

Hasta ese día, `lib/crypto.ts` describía un `scripts/rotate-enc-key.ts` que
**nunca se escribió**, y cuatro documentos de compliance lo citaban como el
procedimiento vigente.

## La inversión que hace esto posible

Lo natural sería poner la clave nueva en `FOLIO_ENC_KEY` y la vieja en un
`FOLIO_ENC_KEY_PREV`. **No se puede**: exige escribir el valor viejo en una
variable nueva, y nadie puede leerlo.

Por eso el orden está invertido:

| variable | contiene | quién la conoce |
|---|---|---|
| `FOLIO_ENC_KEY` | la clave **vieja** | nadie — sigue donde ya estaba |
| `FOLIO_ENC_KEY_NEXT` | la clave **nueva** | vos, que la generaste |

Mientras `_NEXT` esté seteada, `lib/crypto.ts`:

- **escribe** siempre con `_NEXT` — todo lo nuevo nace con la clave destino, así
  que el conjunto de filas viejas sólo puede achicarse;
- **lee** probando `_NEXT` y cayendo a la actual. AES-GCM autentica con un tag
  de 128 bits, así que una clave equivocada **falla** en vez de devolver texto
  corrupto (probabilidad de falso positivo: 2⁻¹²⁸). Esa propiedad es la que
  permite no llevar un identificador de clave en el ciphertext, y tiene su
  propio test.

Los blind index no se pueden "probar y ver si abren" — son de una vía. Para
ellos hay `blindIndexCandidatos()` / `blindIndexPhoneCandidatos()`, que
devuelven los dos hashes para consultar con `.in()` en vez de `.eq()`.

Al terminar: se escribe la clave nueva sobre `FOLIO_ENC_KEY` (valor que sí
conocés) y se borra `_NEXT`.

## Alcance real

**50 columnas cifradas en 22 tablas.** Ninguna participa de un índice, UNIQUE,
PK ni FK. Las dos CHECK que existen miran longitud, no contenido, así que un
re-cifrado no las viola.

**6 columnas de blind index en 3 tablas**: `paciente_identidad.{nombre,dni,
telefono,email}_hash`, `paciente_cuenta.telefono_hash` y
`pseudonimizacion_event.{dni,nombre}_sha256`.

> El inventario completo columna por columna, con la migración que crea cada
> una, está en el reporte de la auditoría del 2026-08-13.
> **`docs/audit/encryption-exceptions.md` NO sirve como fuente**: lista cinco
> columnas que no existen y omite unas veinte que sí.

## Cuatro cosas que rompen una rotación ingenua

### 1. Cuatro tablas de PHI rechazan el `UPDATE`

No es RLS: son triggers `BEFORE UPDATE` que aplican también a `service_role` y
al owner.

| tabla | trigger | qué bloquea |
|---|---|---|
| `sesion` | `sesion_locked_guard` | los SOAP y `tool_data` de sesiones cerradas |
| `sesion_enmienda` | `sesion_enmienda_no_update` | **todo** UPDATE, sin condición |
| `nota_clinica` | `nota_clinica_prevent_write` | **todo** UPDATE, sin condición |
| `instrumento_respuesta` | `instrumento_respuesta_locked_guard` | respuestas ya cerradas |

Son exactamente el núcleo de la historia clínica. Una rotación que no los
resuelva deja lo más importante cifrado con la clave vieja.

La salida es `SET session_replication_role = replica` en la sesión del job
(desactiva triggers; requiere conectar como owner por `POSTGRES_URL_NON_POOLING`).
Eso **no** debilita el append-only del producto: la garantía sigue viviendo en
las policies de RLS, que el job no toca porque conecta como owner.

### 2. `audit_log` guarda copias del ciphertext

El trigger de auditoría hace `to_jsonb(OLD)`/`to_jsonb(NEW)` de la fila
**completa**, sin excluir las columnas `bytea`. Consecuencias:

- ya hay ciphertext de la clave vieja dentro de `audit_log`, y `audit_log` es
  append-only: **no se puede re-cifrar**;
- peor: cada UPDATE de la rotación **dispara una fila nueva de auditoría que
  guarda el ciphertext viejo y el nuevo** — o sea que rotar re-siembra material
  de la clave vieja en el mismo acto de rotar, y duplica el volumen de la tabla.

Decisión: la rotación corre con los triggers desactivados (mismo mecanismo del
punto 1) y deja **una sola entrada de auditoría** describiendo la operación
completa. Una re-encriptación de mantenimiento no es un acceso clínico; anotar
50 columnas × N filas de "el sistema re-cifró esto" degrada el registro que la
Ley 26.529 art. 18 pide, en vez de mejorarlo.

**Consecuencia que hay que aceptar explícitamente**: los payloads viejos de
`audit_log` quedan ilegibles cuando la clave vieja se borre. Se conserva quién
hizo qué y cuándo; se pierde el valor anterior de los campos cifrados. Si eso
no es aceptable, hay que resolverlo **antes** de borrar la clave vieja.

### 3. Placeholders indescifrables

`pseudonimizar_profile` escribe `E'\\x00'` (1 byte) en `profile.nombre_cifrado`
y `apellido_cifrado`. `decryptColumn` los rechaza por longitud. El job tiene que
**saltearlos explícitamente**: tratarlos como "falló el descifrado y aborto" lo
cuelga, y tratarlos como "re-cifrar null" corrompe la fila.

### 4. `pseudonimizacion_event` es irrehasheable por diseño

`dni_sha256` / `nombre_sha256` son copias de los hash de un paciente cuya
identidad ya se borró: no existe el plaintext para recalcularlos. Al rotar la
HMAC key quedan huérfanos y dejan de matchear cualquier hash vivo — que es
justamente el punto de la tabla (probar que se pseudonimizó sin poder
re-identificar). Se documenta y se deja como está.

## Procedimiento

### Paso 0 — antes de tocar nada

```bash
node scripts/backup-logical.mjs        # backup completo, verificado
```

Medir el volumen real (nunca se midió):

```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables
WHERE relname IN ('paciente_identidad','sesion','turno','nota_clinica',
                  'documento_clinico','audit_log')
ORDER BY n_live_tup DESC;
```

### Paso 1 — generar la clave nueva y guardarla

```bash
openssl rand -base64 32     # → FOLIO_ENC_KEY_NEXT
openssl rand -base64 32     # → FOLIO_ENC_HMAC_KEY_NEXT
```

**Guardalas en un gestor de contraseñas ANTES de seguir.** Todo el objetivo de
este procedimiento es terminar con una clave de la que exista copia.

### Paso 2 — arrancar la ventana de rotación

Setear las dos `_NEXT` en Vercel (Production) y redeployar. Desde ese momento
todo lo que se escribe usa la clave nueva y todo lo que se lee funciona con
cualquiera de las dos. **La app sigue andando normalmente.**

Verificar: `/api/health` en 200 y un login real.

### Paso 3 — correr el job — **FALTA**

No existe todavía. Requisitos de diseño, derivados de lo de arriba:

- corre **en producción** (es el único lugar donde la clave vieja es legible);
- conexión directa `pg` como owner, con `SET session_replication_role = replica`;
- por lotes y **reanudable**, con checkpoint persistido — no como
  `rehash-blind-indexes.mjs`, que re-escanea todo en cada corrida;
- por fila: descifrar → re-cifrar → **verificar que el ciphertext nuevo
  descifra al mismo plaintext** → recién ahí escribir;
- saltear los placeholders del punto 3, contándolos aparte;
- **no filtrar por `organization.deleted_at IS NULL`**: `rehash-blind-indexes.mjs`
  lo hace y por eso nunca toca las orgs archivadas. En una rotación eso son
  filas que quedan ilegibles para siempre;
- reportar cobertura: cuántas filas quedan con la clave vieja, por tabla.

### Paso 4 — verificar cobertura total — **FALTA**

Una sonda que confirme que **cero** filas siguen respondiendo a la clave vieja.
Mientras ese número no sea cero, no se avanza.

### Paso 5 — cerrar

1. Escribir la clave nueva sobre `FOLIO_ENC_KEY` y `FOLIO_ENC_HMAC_KEY`.
2. Borrar `FOLIO_ENC_KEY_NEXT` y `FOLIO_ENC_HMAC_KEY_NEXT`.
3. Redeployar.
4. Verificar: login, ficha de un paciente, buscador (que ejercita los blind
   index), `/api/health`.

A partir de acá existe una copia legible de la clave, que era el objetivo.

## Qué falta para poder correr esto

- [x] Doble clave en `lib/crypto.ts`, con tests
- [x] `blindIndexCandidatos` / `blindIndexPhoneCandidatos`
- [ ] Migrar los lectores de blind index a `.in(candidatos)` — hoy usan `.eq()`
      y durante la ventana no encontrarían las filas ya rehasheadas
      (`lib/db/pacientes.ts`, `lib/db/pedidos.ts`, `lib/portal/link-actions.ts`)
- [ ] El job de re-cifrado (Paso 3)
- [ ] El rehash de los 4 blind index de `paciente_identidad`, ampliando
      `scripts/rehash-blind-indexes.mjs` (hoy cubre 3 de 4 y ninguna otra tabla)
- [ ] La sonda de cobertura (Paso 4)
- [ ] Medir el volumen real
