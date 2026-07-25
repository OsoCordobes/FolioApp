/**
 * Folio · pantalla de gate bloqueado para miembros NO-OWNER (E3).
 *
 * Antes: con el trial/pago vencido, (app)/layout.tsx redirige a TODOS los
 * roles a /configuracion/billing, pero esa página hacía notFound() para todo
 * rol distinto de OWNER → el staff de una clínica veía un 404 crudo en toda
 * la app, sin ninguna explicación.
 *
 * Ahora: explicación honesta y accionable ("avisale al titular"), SIN datos
 * de billing (precio, estado de suscripción y cargos siguen siendo solo del
 * OWNER). Server Component puro: sin estado, sin acciones.
 */

export function BillingLockedMember() {
  return (
    <div className="cfg">
      <header className="cfg-head">
        <div>
          <span className="fi-eyebrow">facturación</span>
          <h1>Suscripción del consultorio</h1>
        </div>
      </header>
      <section className="fi-billing-locked" role="status">
        <h2>La suscripción del consultorio necesita atención.</h2>
        <p>
          Avisale al titular de la cuenta para reactivar el acceso: es la única
          persona que puede gestionar la suscripción.
        </p>
        <p className="fi-billing-locked-note">
          Los pacientes, turnos e historias clínicas están guardados — no se
          pierde nada mientras tanto.
        </p>
      </section>
    </div>
  );
}
