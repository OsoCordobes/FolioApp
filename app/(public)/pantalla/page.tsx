import type { Metadata } from "next";

import { CallerScreen } from "@/components/caller/caller-screen";
import "@/styles/caller.css";

export const metadata: Metadata = { title: "Pantalla de espera · Folio", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function PantallaPage() { return <CallerScreen />; }
