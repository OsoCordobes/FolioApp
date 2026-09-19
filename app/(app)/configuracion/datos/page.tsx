import { OwnDataPage } from "@/components/configuracion/own-data-page";

export const dynamic = "force-dynamic";

export default function DatosPage() {
  return <OwnDataPage returnPath="/configuracion/datos" />;
}
