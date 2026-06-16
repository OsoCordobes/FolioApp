/**
 * Folio · DirectorioCard · tarjeta de un consultorio en /profesionales.
 *
 * Server component liviano (NO el PublicCard client pesado): logo/iniciales,
 * nombre, badge de especialidad, ciudad, bio truncada, CTA "Reservar" →
 * /book/[slug]?ref=directorio. Acento por org. Solo datos públicos de la org.
 */

import { AvatarIniciales } from "@/components/avatar-iniciales";
import type { DirectorioOrg } from "@/lib/db/directorio";
import { getEspecialidadMeta } from "@/lib/especialidades/meta";
import { formatRubro } from "@/lib/format/identity";

function isValidHex(s: string | null | undefined): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

export function DirectorioCard({ org }: { org: DirectorioOrg }) {
  const acento = isValidHex(org.acentoHex) ? org.acentoHex : "#8A6722";
  // Etiqueta de especialidad: nombre del registry si es slug conocido; si no,
  // el rubro humanizado (no etiqueta mal a orgs fuera de las 3 especialidades).
  const espLabel =
    org.especialidad && getEspecialidadMeta(org.especialidad).slug === org.especialidad
      ? getEspecialidadMeta(org.especialidad).nombre
      : formatRubro(org.especialidad);
  const lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");

  return (
    <a
      className="dir-card"
      href={`/book/${org.slug}?ref=directorio`}
      style={{ ["--accent" as string]: acento }}
    >
      <div className="dir-card-head">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logoUrl}
            alt={`Logo de ${org.nombre}`}
            className="dir-card-logo"
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <AvatarIniciales fullName={org.nombre} acentoHex={acento} size="md" />
        )}
        <div className="dir-card-id">
          <p className="dir-card-name">{org.nombre}</p>
          {espLabel ? <span className="dir-card-esp">{espLabel}</span> : null}
        </div>
      </div>
      {lugar ? <p className="dir-card-lugar">{lugar}</p> : null}
      {org.bio ? <p className="dir-card-bio">{org.bio}</p> : null}
      <span className="dir-card-cta">Reservar turno →</span>
    </a>
  );
}
