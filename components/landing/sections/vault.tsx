/**
 * Folio · Landing — La bóveda (#seguridad) · rediseño "Un día con Folio" (E3).
 *
 * Server component. Panel DARK PREMIUM incluso en light mode (estilo Mercury):
 * `.fl-vault` redeclara localmente las custom properties del bloque
 * [data-theme="dark"] de folio.css, así todo lo interior hereda el sistema
 * dark completo y en dark mode real la sección es idéntica (cero reglas extra).
 *
 * Narrativa: la escena 14:00 de la timeline ("la nota se cifra") desemboca acá.
 * Reemplazó a la antigua sección Security (archivo y CSS "fl-security" borrados).
 */

import { Lock } from "@/components/icons";
import { revealRange } from "../reveal";

interface VaultItem {
  /** Identificador display (n° de ley / sigla técnica) — Geist Mono gigante. */
  num: string;
  /** Una línea de descripción. */
  desc: string;
  /** Identificadores largos (AES-256-GCM) bajan de cuerpo vía modificador. */
  code?: boolean;
}

const ITEMS: VaultItem[] = [
  {
    num: "25.326",
    desc: "Protección de datos personales, desde el diseño.",
  },
  {
    num: "26.529",
    desc: "Tu historia clínica, conservada 10 años como exige la ley.",
  },
  {
    num: "AES-256-GCM",
    desc: "Cada nota se cifra antes de tocar la base de datos.",
    code: true,
  },
  {
    num: "RLS",
    desc: "Aislamiento por consultorio, a nivel de base de datos.",
  },
];

export function Vault() {
  return (
    <section id="seguridad" className="fl-vault" data-fl-section="vault">
      <div className="fl-vault-inner">
        <p className="fl-vault-eyebrow fl-reveal">
          <span className="fl-vault-eyebrow-icon" aria-hidden="true">
            <Lock size={14} />
          </span>
          La bóveda
        </p>
        <h2 className="fl-vault-title fl-reveal">Diseñado para la ley argentina.</h2>
        <dl className="fl-vault-grid">
          {ITEMS.map((item, i) => (
            <div key={item.num} className="fl-vault-item fl-reveal" style={revealRange(i)}>
              <dt className={item.code ? "fl-vault-num fl-vault-num--code" : "fl-vault-num"}>
                {item.num}
              </dt>
              <dd className="fl-vault-desc">{item.desc}</dd>
            </div>
          ))}
        </dl>
        <p className="fl-vault-foot fl-reveal">
          Tus datos viven en Sudamérica · región sa-east-1
        </p>
      </div>
    </section>
  );
}
