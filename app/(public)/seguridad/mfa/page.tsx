import { redirect } from "next/navigation";
import { SideArt } from "@/components/auth/side-art";
import { MotionProvider } from "@/components/motion/motion-provider";
import { MfaForm } from "@/components/auth/mfa-form";
import { readMfaStatus, safeMfaReturnPath } from "@/lib/auth/mfa-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificación en dos pasos · Folio", robots: { index: false, follow: false } };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?redirect=/seguridad/mfa");
  const [access, factors] = await Promise.all([readMfaStatus(client), client.auth.mfa.listFactors()]);
  const params = await searchParams;
  const next = safeMfaReturnPath(params.next ?? (access.ok && !access.data.isStaff ? "/portal" : "/hoy"));
  return <MotionProvider><div className="au-app">
    <SideArt />
    <main className="au-main ph-no-capture ph-no-capture-recording" data-sensitive><div className="au-form-pane"><div className="au-form-inner">
      {!access.ok || factors.error ? <>
        <h1>No pudimos verificar tu sesión</h1>
        <p>Reintentá en unos instantes. Tus datos siguen protegidos.</p>
        <a className="fi-btn fi-btn-primary" href="/seguridad/mfa">Reintentar</a>
      </> : <MfaForm status={access.data} next={next} factors={factors.data.totp.map(f => ({ id: f.id, name: f.friendly_name || "Autenticador" }))} />}
      <form action="/api/auth/signout" method="post"><button className="fi-btn fi-btn-ghost" type="submit">Cerrar sesión</button></form>
    </div></div></main>
  </div></MotionProvider>;
}
