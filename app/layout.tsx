import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/public/folio.css";
import "@/styles/experience.css";
import "@/styles/platform.css";
import "@/styles/clinical-experience.css";
import "@/styles/auth-experience.css";
import "@/styles/onboarding-experience.css";
import "@/styles/public-experience.css";
import { CookieBanner } from "@/components/cookie-banner";
import { FolioPostHogProvider } from "@/lib/observability/posthog-client";
import { TweaksProvider } from "@/lib/tweaks-context";

const folioSans = localFont({ src: "../public/fonts/plus-jakarta-sans-latin.woff2", variable: "--font-folio", display: "swap", weight: "200 800", fallback: ["Arial"] });

export const metadata: Metadata = {
  title: { default: "Folio", template: "%s · Folio" },
  description: "Agenda, historia clínica y cobros para profesionales y equipos de salud en Argentina.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-AR" data-theme="light" className={folioSans.variable} suppressHydrationWarning>
    <body><FolioPostHogProvider><TweaksProvider>{children}</TweaksProvider></FolioPostHogProvider><CookieBanner /></body>
  </html>;
}

