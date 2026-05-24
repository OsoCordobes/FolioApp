/**
 * Folio · 404 específico para booking público (/book/[slug]).
 *
 * Se dispara cuando el slug no matchea ninguna org activa. Copy específico:
 * la persona que llega acá es probablemente un paciente con un link viejo o
 * mal-tipeado, no tiene cuenta y no debe ser empujada a /login o /hoy.
 *
 * Diseño: mismo styling que el 404 global pero sin botones de navegación
 * interna (los pacientes no son nuestros usuarios authenticated).
 */

export const metadata = {
  title: "Consultorio no disponible · Folio",
};

export default function BookSlugNotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        background: "var(--bg)",
        color: "var(--ink)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <p
          style={{
            margin: 0,
            color: "var(--accent-warm)",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontSize: 13,
          }}
        >
          Consultorio no encontrado
        </p>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>
          Este consultorio no está disponible
        </h1>
        <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.6 }}>
          El link que estás usando no corresponde a ningún consultorio activo
          en Folio. Es posible que el link haya cambiado o que el profesional
          haya pausado su agenda online.
        </p>
        <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.6 }}>
          Pedile al profesional el link actualizado de su consultorio.
        </p>
      </div>
    </main>
  );
}
