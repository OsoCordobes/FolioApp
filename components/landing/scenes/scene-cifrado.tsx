/**
 * Folio · Landing · Escena 14:00 — cifrado de la nota ("Un día con Folio" · E2).
 *
 * Visual estrella: card de nota SOAP de dos capas — el texto plano clínico
 * (.fl-cipher-pt, de mentira) y la misma caja en Geist Mono con ciphertext
 * fake (.fl-cipher-ct). En el modo sticky el ciphertext se revela con un
 * clip-path sweep (inset derecho 100% → 0) acompañado por la línea de
 * barrido .fl-cipher-scan, y el candado popea con --spring-soft al final.
 *
 * Estado base (sin animación): la card se muestra YA CIFRADA — clip-path
 * final y candado visible — así el mensaje funciona sin motion.
 * Server component, decorativo (aria-hidden), cero JS.
 * Clases .fl-cipher-* en public/folio.css (fragmento E2).
 */

import { Lock } from "@/components/icons";

/* Ciphertext fake tipo base64 — suficiente para cubrir las 4 líneas SOAP
   (la caja recorta el sobrante con overflow: hidden). */
const CIPHERTEXT =
  "Qk3mX9aLpUv7Tz1HsEYwRoCgN5dJfB8iA6kSGhPtxq2W4eVu0yDnZbrMjOl1cF" +
  "KhwT8rXm2vLq9aZsE4dGyU6oNiJ3bPcW7fRk0tHxAvDM5lYeQnS1uIzgC9jBwK" +
  "p2VrT6mFhX4sLdN8qYoZaE3cUiP0vGtRkJ7yMbAw5nDexHfS9zQ1lCuOj6KgWi" +
  "8TmrV2pXbY4hNsLqE7dAoZ3fUcMkJ0wRtGyP5xenSI1vBzCl9jDuQ6hKgFmW2a" +
  "rTNXp8sV4bLdYqE0oAiZ7cUfMt3kJwRhGyB5xPnSe1vDzQl9jCuOmK6gHi==";

export function SceneCifrado() {
  return (
    <div className="fl-scene-visual" aria-hidden="true">
      <div className="fl-cipher">
        <article className="fl-cipher-card">
          <header className="fl-cipher-head">
            <span className="fl-cipher-title">Nota de evolución · M. González</span>
            <span className="fl-cipher-tag">
              <Lock size={12} />
              AES-256-GCM
            </span>
          </header>

          <div className="fl-cipher-body">
            {/* capa 1 · texto plano clínico (de mentira) */}
            <p className="fl-cipher-pt">
              <span>
                <b>S</b> — Dolor lumbar en baja: 3/10 esta semana.
              </span>
              <span>
                <b>O</b> — Movilidad completa; contractura leve L4-L5.
              </span>
              <span>
                <b>A</b> — Evolución favorable, 4ª sesión.
              </span>
              <span>
                <b>P</b> — Continuar ejercicios; control en 15 días.
              </span>
            </p>

            {/* capa 2 · la misma caja, ya cifrada (sweep en el modo sticky) */}
            <p className="fl-cipher-ct">
              <span className="fl-cipher-ct-meta">enc · v1 · nonce 9fK2qVd0R3w7</span>
              {CIPHERTEXT}
            </p>

            <span className="fl-cipher-scan" />
            <span className="fl-cipher-lock">
              <Lock size={14} />
            </span>
          </div>

          <footer className="fl-cipher-foot">la base de datos solo guarda esto</footer>
        </article>
      </div>
    </div>
  );
}
