/**
 * Folio · Landing — tira de especialidades (proof band, inventory-free).
 *
 * Banda calma entre el día y la bóveda: confirma "esto es para mí" y la
 * cobertura multi-especialidad que el producto YA soporta (fichas por
 * especialidad: cardio/psico/kinesio…). 100 % real — sin testimonios
 * inventados. Server component, cero JS.
 */

const ESPECIALIDADES = [
  "Kinesiología",
  "Nutrición",
  "Psicología",
  "Cardiología",
  "Quiropraxia",
] as const;

export function SpecialtyStrip() {
  return (
    <section className="fl-specialties" aria-label="Especialidades">
      <p className="fl-specialties-lead">Hecho para tu especialidad</p>
      <ul className="fl-specialties-list">
        {ESPECIALIDADES.map((e) => (
          <li key={e} className="fl-specialties-item">
            {e}
          </li>
        ))}
      </ul>
    </section>
  );
}
