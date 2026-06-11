/**
 * Folio · Landing · Escena 14:00 — cifrado de la nota ("Un día con Folio" · E2/R2).
 *
 * Visual estrella: ficha SOAP de dos capas — header de ficha (avatar +
 * paciente + tag Sesión 4 + hora), las 4 secciones S/O/A/P con label mono y
 * texto clínico plausible (.fl-cipher-pt, de mentira) y la misma caja en
 * Geist Mono con ciphertext fake en bloques con guiones (.fl-cipher-ct).
 * En el modo sticky el ciphertext se revela con un clip-path sweep (inset
 * derecho 100% → 0, range contain 44%–58% INTACTO) acompañado por la línea
 * de barrido .fl-cipher-scan, y el pill candado + AES-256-GCM popea con
 * --spring-soft al final (range contain 56%–61% intacto). Detrás asoma otra
 * ficha desenfocada, como las capas del hero.
 *
 * Estado base (sin animación): la card se muestra YA CIFRADA — clip-path
 * final y candado visible — así el mensaje funciona sin motion.
 * Server component, decorativo (aria-hidden), cero JS.
 * Clases .fl-cipher-* en public/folio.css (fragmento E2 + refinamiento R2).
 */

import { Lock } from "@/components/icons";

interface SoapSection {
  k: string;
  label: string;
  text: string;
}

const SOAP: SoapSection[] = [
  {
    k: "S",
    label: "subjetivo",
    text: "Refiere dolor lumbar 3/10, en baja. Tolera bien la rutina de ejercicios en casa.",
  },
  {
    k: "O",
    label: "objetivo",
    text: "Flexión de tronco completa; contractura leve en paravertebrales L4-L5.",
  },
  {
    k: "A",
    label: "análisis",
    text: "Evolución favorable a la 4ª sesión. Mejor control motor lumbopélvico.",
  },
  {
    k: "P",
    label: "plan",
    text: "Progresar carga del plan domiciliario; control en 15 días.",
  },
];

/* Ciphertext fake — bloques tipo base64 separados por guiones, suficiente
   para cubrir toda la caja SOAP (el sobrante lo recorta overflow: hidden). */
const CIPHERTEXT =
  "Qk3m-X9aL-pUv7-Tz1H-sEYw-RoCg-N5dJ-fB8i-A6kS-GhPt-xq2W-4eVu-" +
  "0yDn-Zbr9-MjOl-1cFK-hwT8-rXm2-vLq9-aZsE-4dGy-U6oN-iJ3b-PcW7-" +
  "fRk0-tHxA-vDM5-lYeQ-nS1u-Izg9-C9jB-wKp2-VrT6-mFhX-4sLd-N8qY-" +
  "oZaE-3cUi-P0vG-tRkJ-7yMb-Aw5n-DexH-fS9z-Q1lC-uOj6-KgWi-8Tmr-" +
  "V2pX-bY4h-NsLq-E7dA-oZ3f-UcMk-J0wR-tGyB-5xPn-Se1v-DzQl-9jCu-" +
  "OmK6-gHi2-rTNX-p8sV-4bLd-YqE0-oAiZ-7cUf-Mt3k-JwRh-GyB5-xPnS-" +
  "e1vD-zQl9-jCuO-K6gH-i8Tm-rV2p-XbY4-hNsL-qE7d-AoZ3-fUcM-kJ0w-" +
  "RtGy-P5xe-nSI1-vBzC-l9jD-uQ6h-KgFm-W2aT-Nx8s-V4bL-dYqE-0oAi-" +
  "Z7cU-fMt3-kJwR-hGyN-5xPn-Se1v-DzQl-9jCu-OmK6-gHi8-TmrV-2pXb-" +
  "Y4hN-sLqE-7dAo-Z3fU-cMkJ-0wRt-GyP5-xenS-I1vB-zCl9-jDuQ-6hKg==";

export function SceneCifrado() {
  return (
    <div className="fl-scene-visual" aria-hidden="true">
      <div className="fl-cipher">
        {/* capa trasera — otra ficha del día, desenfocada */}
        <article className="fl-cipher-card fl-cipher-back">
          <header className="fl-cipher-head">
            <span className="fl-cipher-who">
              <span className="fl-cipher-ava">JP</span>
              <span className="fl-cipher-id">
                <span className="fl-cipher-title">Julián P.</span>
                <span className="fl-cipher-sub">Quiropraxia · control</span>
              </span>
            </span>
            <span className="fl-cipher-time">13:00</span>
          </header>
          <div className="fl-cipher-back-lines">
            <span />
            <span />
            <span />
          </div>
        </article>

        {/* capa frontal — la ficha que se está cerrando */}
        <article className="fl-cipher-card fl-cipher-front">
          <header className="fl-cipher-head">
            <span className="fl-cipher-who">
              <span className="fl-cipher-ava">BM</span>
              <span className="fl-cipher-id">
                <span className="fl-cipher-title">Belén M.</span>
                <span className="fl-cipher-sub">Nota de evolución · Kinesiología</span>
              </span>
            </span>
            <span className="fl-cipher-meta">
              <span className="fl-cipher-tag">Sesión 4</span>
              <span className="fl-cipher-time">14:00</span>
            </span>
          </header>

          <div className="fl-cipher-body">
            {/* capa 1 · texto plano clínico (de mentira) */}
            <div className="fl-cipher-pt">
              {SOAP.map((sec) => (
                <span key={sec.k} className="fl-cipher-sec">
                  <span className="fl-cipher-sec-label">
                    <b>{sec.k}</b> · {sec.label}
                  </span>
                  <span className="fl-cipher-sec-text">{sec.text}</span>
                </span>
              ))}
            </div>

            {/* capa 2 · la misma caja, ya cifrada (sweep en el modo sticky) */}
            <p className="fl-cipher-ct">
              <span className="fl-cipher-ct-meta">
                enc · v1 · AES-256-GCM · nonce 9fK2-qVd0-R3w7
              </span>
              {CIPHERTEXT}
            </p>

            <span className="fl-cipher-scan" />
            <span className="fl-cipher-lock">
              <Lock size={13} />
              AES-256-GCM
            </span>
          </div>

          <footer className="fl-cipher-foot">la base de datos solo guarda esto</footer>
        </article>
      </div>
    </div>
  );
}
