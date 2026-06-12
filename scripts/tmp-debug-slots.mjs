import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ORG_SLUG = "lautaro-folio";

const { data: org, error: orgErr } = await supabase
  .from("organization").select("id, opt_out_public_listing, deleted_at")
  .eq("slug", ORG_SLUG).is("deleted_at", null).maybeSingle();
console.log("org:", org, orgErr?.message ?? "");

const { data: prof, error: profErr } = await supabase
  .from("member").select("id")
  .eq("organization_id", org.id).eq("es_colegiado", true)
  .is("deleted_at", null).limit(1).maybeSingle();
console.log("profesional:", prof, profErr?.message ?? "");

const rangeStart = new Date();
const rangeEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

const results = await Promise.all([
  supabase.from("disponibilidad_profesional")
    .select("dia_semana, hora_inicio, hora_fin, vigencia_desde, vigencia_hasta")
    .eq("organization_id", org.id).eq("member_id", prof.id).eq("activa", true),
  supabase.from("bloqueo")
    .select("inicio, duracion_min")
    .eq("organization_id", org.id).eq("profesional_id", prof.id)
    .gte("inicio", rangeStart.toISOString()).lt("inicio", rangeEnd.toISOString()),
  supabase.from("turno")
    .select("inicio, duracion_min")
    .eq("organization_id", org.id).eq("profesional_id", prof.id)
    .in("estado", ["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO"])
    .gte("inicio", rangeStart.toISOString()).lt("inicio", rangeEnd.toISOString()),
  supabase.from("pedido")
    .select("fecha_propuesta, duracion_min")
    .eq("organization_id", org.id).eq("estado", "PENDIENTE")
    .or(`profesional_id.eq.${prof.id},profesional_id.is.null`)
    .not("fecha_propuesta", "is", null)
    .gte("fecha_propuesta", rangeStart.toISOString()).lt("fecha_propuesta", rangeEnd.toISOString()),
]);

const names = ["disponibilidad", "bloqueo", "turno", "pedido"];
results.forEach((r, i) => {
  console.log(`${names[i]}: rows=${r.data?.length ?? "null"} error=${r.error?.message ?? "ninguno"}`);
});
