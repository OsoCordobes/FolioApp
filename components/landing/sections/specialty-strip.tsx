/**
 * Folio · Landing — tira de especialidades (proof band, inventory-free).
 *
 * Banda calma entre el día y la bóveda: confirma "esto es para mí" y la
 * cobertura por especialidad. Fichas por especialidad REALES hoy: quiropraxia,
 * psicología y cardiología (kinesiología, nutrición y más en el roadmap). 100 %
 * real — sin testimonios inventados, sin listar especialidades que aún no
 * existen como reales. Server component, cero JS.
 */

/** Especialidades con ficha clínica real disponible hoy. */
const PRINCIPALES = ["Quiropraxia", "Psicología", "Cardiología"] as const;

/** Roadmap (próximamente) — no se presentan como disponibles. */
const PROXIMAMENTE = "Kinesiología · Nutrición · y más en camino";

export function SpecialtyStrip() {
  return (
    <section className="fl-specialties" aria-label="Especialidades">
      <p className="fl-specialties-lead">Fichas pensadas para tu especialidad</p>
      <ul className="fl-specialties-list">
        {PRINCIPALES.map((e) => (
          <li key={e} className="fl-specialties-item">
            {e}
          </li>
        ))}
      </ul>
      <p className="fl-specialties-soon">
        <span className="fl-specialties-soon-badge">Próximamente</span>
        <span className="fl-specialties-soon-list">{PROXIMAMENTE}</span>
      </p>
    </section>
  );
}
