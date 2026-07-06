/**
 * Folio · /portal/login — entrada del portal del paciente (Fase 3 · P3).
 *
 * Pantalla pública (el middleware la lista en PUBLIC_PATHS). Magic-link por
 * email vía Server Action. Reusa el shell `au-app` + SideArt de la pantalla de
 * auth para mantener la estética; el form es propio del portal (sin password).
 */

import { Suspense } from "react";

import { SideArt } from "@/components/auth/side-art";
import { MotionProvider } from "@/components/motion/motion-provider";

import { PortalLoginForm } from "./login-form";

const ERROR_MESSAGES: Record<string, string> = {
  sin_cuenta:
    "Ese link no corresponde a una cuenta de paciente. Si tu consultorio te dio acceso, escribiles.",
  code_expired: "El link expiró o ya fue usado. Pedí uno nuevo.",
  otp_expired: "El link expiró o ya fue usado. Pedí uno nuevo.",
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? ERROR_MESSAGES[error] ?? null : null;

  return (
    <MotionProvider>
      <div className="au-app">
        <SideArt />
        <Suspense fallback={<main className="au-main" />}>
          <main className="au-main">
            <PortalLoginForm initialError={initialError} />
          </main>
        </Suspense>
      </div>
    </MotionProvider>
  );
}
