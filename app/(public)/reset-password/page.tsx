/**
 * Folio · /reset-password
 *
 * Pantalla donde el usuario elige su contraseña nueva después de hacer click
 * en el link del email. /api/auth/reset deja una sesión activa antes de
 * redirigir aquí — si no hay sesión, el form muestra error y manda a /login.
 */

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { MotionProvider } from "@/components/motion/motion-provider";
import { SideArt } from "@/components/auth/side-art";

export const metadata = {
  title: "Elegí tu nueva contraseña · Folio",
  description: "Configurá una contraseña nueva para tu cuenta de Folio.",
};

export default function ResetPasswordPage() {
  return (
    <MotionProvider>
      <div className="au-app">
        <SideArt />
        <ResetPasswordForm />
      </div>
    </MotionProvider>
  );
}
