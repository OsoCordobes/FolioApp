/**
 * Placeholder de /hoy mientras se migra el Dashboard (F1.6).
 *
 * Existe para que el shell autenticado pueda renderearse y se pueda
 * verificar layout + sidebar antes de migrar el contenido del Dashboard.
 */
export default function HoyPage() {
  return (
    <div className="fi-page" style={{ padding: 32 }}>
      <h1 className="mono" style={{ fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
        Hoy · placeholder
      </h1>
      <p style={{ marginTop: 16, color: "var(--ink-2)" }}>
        El Dashboard pixel-perfect se migra en F1.6.
      </p>
    </div>
  );
}
