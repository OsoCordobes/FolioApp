import { supportMailto } from "@/lib/support";
export const metadata = { title: "Recuperar acceso · Folio", robots: { index: false, follow: false } };
export default function MfaRecoveryPage() {
  return <div className="au-app"><main className="au-main"><div className="au-form-pane"><div className="au-form-inner">
    <h1>Recuperar el acceso a tu cuenta</h1>
    <p>Si tenés otro autenticador configurado, volvé a la verificación y elegí ese dispositivo.</p>
    <p>Si perdiste todos tus autenticadores, pedí asistencia. La recuperación requiere comprobar tu identidad y tu vínculo con el consultorio. No se habilita solamente por recibir un correo.</p>
    <p>Cambiar la contraseña o entrar por el portal de pacientes no elimina la verificación en dos pasos.</p>
    <p>No envíes contraseñas, códigos del autenticador, claves de configuración ni datos de pacientes.</p>
    <a className="fi-btn fi-btn-primary" href={supportMailto("Ayuda para recuperar mi autenticador")}>Contactar a soporte</a>
    <a href="/seguridad/mfa">Volver a la verificación</a>
    <form action="/api/auth/signout" method="post"><button type="submit" className="fi-btn fi-btn-ghost">Cerrar sesión</button></form>
  </div></div></main></div>;
}
