import Link from "next/link";
import { FolioMark } from "@/components/folio-mark";

/** Folio's own brand, shared across the public front door and account setup. */
export function FolioBrand({ className = "" }: { className?: string }) {
  return <Link className={`folio-brand ${className}`} href="/" aria-label="Folio, volver al inicio">
    <FolioMark size={30} />
    <span className="folio-brand-wordmark">folio<span className="folio-brand-dot">.</span></span>
  </Link>;
}
