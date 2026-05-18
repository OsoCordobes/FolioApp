/**
 * Folio · resolver organization desde el phone_number_id de Meta WhatsApp.
 *
 * En cada webhook inbound, Meta nos da el `phone_number_id` del business
 * number que recibió el mensaje. Lookup en `organization.whatsapp_phone_number_id`
 * (M18). Si no resuelve, el webhook log + 200 OK (no acumular errores Meta-side).
 *
 * Server-only (usa service client porque webhooks no tienen sesión user).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface ResolvedOrg {
  id: string;
  nombre: string;
  timezone: string;
}

export async function resolveOrgByPhoneNumberId(phoneNumberId: string): Promise<ResolvedOrg | null> {
  if (!phoneNumberId) return null;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organization")
    .select("id, nombre, timezone")
    .eq("whatsapp_phone_number_id", phoneNumberId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.warn(`[whatsapp] error resolviendo org para phone_number_id=${phoneNumberId}: ${error.message}`);
    return null;
  }
  if (!data) return null;
  return data as ResolvedOrg;
}
