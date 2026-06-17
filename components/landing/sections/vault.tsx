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
  /** Display (n° de ley / cifra / frase corta) — Geist Mono gigante. */
  num: string;
  /** Una línea de descripción, en lenguaje humano (la audiencia es médica). */
  desc: string;
  /** Displays largos bajan de cuerpo vía modificador. */
  code?: boolean;
}

const ITEMS: VaultItem[] = [
  {
    num: "10 años",
    desc: "Cada historia clínica, conservada el tiempo que exige la Ley 26.529. Ni un día menos.",
  },
  {
    num: "25.326",
    desc: "Construido sobre la Ley 25.326 de datos personales: privacidad por diseño, no como agregado.",
  },
  {
    num: "AES-256",
    desc: "Cada nota se cifra antes de llegar a la base de datos. Aunque alguien accediera a la base, vería texto ilegible — solo tu equipo la lee.",
  },
  {
    num: "Solo tu equipo",
    desc: "Cada consultorio vive aislado del resto. Nadie de afuera puede ver tus pacientes ni tu agenda.",
    code: true,
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
        <p className="fl-vault-sub fl-reveal">
          Muchas plataformas alojan los datos de tus pacientes fuera de la región. Nosotros los
          ciframos y los mantenemos en Sudamérica. Esto es lo que eso significa:
        </p>
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
          Tus datos se alojan en un datacenter de São Paulo, en Sudamérica — no en Estados Unidos
          ni en Europa. Son tuyos: los exportás en CSV cuando quieras.
        </p>
      </div>
    </section>
  );
}
