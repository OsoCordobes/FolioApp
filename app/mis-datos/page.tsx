import type { Metadata } from "next";
import { OwnDataPage } from "@/components/configuracion/own-data-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Mis datos", robots: { index: false, follow: false } };

/** Outside the clinic layout: billing cannot block account-data requests. */
export default function PersonalDataPage() {
  return <OwnDataPage returnPath="/mis-datos" standalone />;
}
