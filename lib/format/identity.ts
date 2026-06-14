/**
 * Folio · helpers de display de identidad (nombre, rubro).
 *
 * Puras (no DB). Las usan Sidebar y otros componentes que muestran
 * el nombre del profesional + rubro del consultorio.
 */

const RUBRO_LABELS: Record<string, string> = {
  quiropraxia: "Quiropraxia",
  cardiologia: "Cardiología",
  kinesiologia: "Kinesiología",
  fonoaudiologia: "Fonoaudiología",
  psicologia: "Psicología",
  medicina_general: "Medicina general",
  odontologia: "Odontología",
  nutricion: "Nutrición",
  fisiatria: "Fisiatría",
  osteopatia: "Osteopatía",
  podologia: "Podología",
  terapia_ocupacional: "Terapia ocupacional",
  enfermeria: "Enfermería",
  pediatria: "Pediatría",
  ginecologia: "Ginecología",
  dermatologia: "Dermatología",
  obstetricia: "Obstetricia",
  otro: "Profesional de la salud",
};

export function formatRubro(rubro: string | null | undefined): string | null {
  if (!rubro) return null;
  // Las keys del map usan underscore, pero los RubroId del onboarding
  // (lib/onboarding/templates.ts) usan guion ("terapia-ocupacional") — la DB
  // puede traer cualquiera de los dos. Normalizamos guiones a underscore para
  // el lookup; el fallback capitaliza y convierte ambos separadores a espacio.
  const key = rubro.toLowerCase().trim().replace(/-/g, "_");
  return RUBRO_LABELS[key] ?? capitalize(key.replace(/_/g, " "));
}

export function formatProfesionalDisplay(
  profile: { nombre: string | null; apellido: string | null },
  organization: { nombre: string },
): string {
  const nombre = (profile.nombre ?? "").trim();
  const apellido = (profile.apellido ?? "").trim();
  if (nombre && apellido) return `${nombre} ${apellido}`;
  if (nombre) return nombre;
  if (apellido) return apellido;
  // Fallback: nombre de la org (caso edge de profile sin nombre seteado).
  return organization.nombre;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
