/**
 * Folio · Onboarding · Zod schemas server-side.
 *
 * Cada step del wizard valida con su schema antes de tocar DB. Los mensajes
 * de error vuelven al cliente y se muestran inline.
 *
 * El cliente puede usar los mismos schemas (re-exportados) para validación
 * UI antes del submit — single source of truth.
 */

import { z } from "zod";

// ─── Step 1: Credenciales ──────────────────────────────────────────────────

export const signUpSchema = z.object({
  email: z
    .string({ error: "Email requerido." })
    .trim()
    .toLowerCase()
    .email({ message: "Email inválido." }),
  password: z
    .string({ error: "Contraseña requerida." })
    .min(8, "Contraseña debe tener mínimo 8 caracteres.")
    .max(72, "Contraseña demasiado larga."),
  // BCrypt limita a 72 bytes; nos quedamos cómodos en 72 chars.
});

export type SignUpInput = z.infer<typeof signUpSchema>;

// ─── Step 2-3: Identidad profesional ───────────────────────────────────────

export const identidadProfesionalSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "Nombre requerido.")
    .max(40, "Nombre demasiado largo (max 40)."),
  apellido: z
    .string()
    .trim()
    .min(1, "Apellido requerido.")
    .max(40, "Apellido demasiado largo (max 40)."),
  matricula: z
    .string()
    .trim()
    .max(60, "Matrícula demasiado larga.")
    .default(""),
  tel: z
    .string()
    .trim()
    .max(30, "Teléfono demasiado largo.")
    .default(""),
});

// ─── Step 4: Consultorio ───────────────────────────────────────────────────

export const consultorioBaseSchema = z.object({
  consultorioNombre: z
    .string()
    .trim()
    .min(1, "Nombre del consultorio requerido.")
    .max(120, "Nombre demasiado largo."),
  rubro: z
    .string()
    .trim()
    .min(1, "Rubro requerido."),
  direccion: z.string().trim().max(160).default(""),
  ciudad: z
    .string()
    .trim()
    .min(1, "Ciudad requerida.")
    .max(80),
  provincia: z
    .string()
    .trim()
    .min(1, "Provincia requerida.")
    .max(80),
  instagram: z
    .string()
    .trim()
    .max(40)
    .regex(/^[a-zA-Z0-9._]*$/, "Usuario de Instagram inválido (solo letras, números, punto, guión bajo).")
    .optional()
    .or(z.literal("")),
  acento: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color acento debe ser hex válido (ej. #c89b3c).")
    .default("#c89b3c"),
  // ─── M20: campos públicos premium ───────────────────────────────────────
  telefonoPublico: z
    .string()
    .trim()
    .max(30, "Teléfono demasiado largo.")
    .optional()
    .or(z.literal("")),
  direccionCompleta: z
    .string()
    .trim()
    .max(200, "Dirección demasiado larga.")
    .optional()
    .or(z.literal("")),
  bio: z
    .string()
    .trim()
    .max(280, "Bio máximo 280 caracteres.")
    .optional()
    .or(z.literal("")),
  slugManual: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Link inválido: solo minúsculas, números y guiones simples.")
    .min(3, "Link mínimo 3 caracteres.")
    .max(50, "Link máximo 50 caracteres.")
    .optional()
    .or(z.literal("")),
});

// ─── Step 6: Horarios ──────────────────────────────────────────────────────

const DIA_LBL = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;

export const horariosSchema = z.object({
  diasActivos: z
    .array(z.enum(DIA_LBL))
    .min(1, "Seleccioná al menos un día de atención.")
    .max(7),
  franjas: z
    .array(
      z.tuple([
        z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida (HH:MM)."),
        z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida (HH:MM)."),
      ]),
    )
    .min(1, "Definí al menos una franja horaria.")
    .superRefine((franjas, ctx) => {
      for (let i = 0; i < franjas.length; i++) {
        const [from, to] = franjas[i];
        if (from >= to) {
          ctx.addIssue({
            code: "custom",
            path: [i],
            message: `Franja ${i + 1}: hora "desde" debe ser menor que "hasta".`,
          });
        }
      }
    }),
  slotMin: z
    .number()
    .int()
    .min(5, "Slot mínimo: 5 minutos.")
    .max(480, "Slot máximo: 8 horas."),
});

// ─── Step 7: Servicios ─────────────────────────────────────────────────────

export const servicioSchema = z.object({
  nombre: z.string().trim().min(1, "Nombre requerido.").max(80),
  dur: z.number().int().min(5).max(480),
  precioCents: z.number().int().min(0),
  tipoCanonico: z.string().trim().min(1).max(40),
});

export const serviciosListSchema = z
  .array(servicioSchema)
  .min(1, "Configurá al menos un servicio.")
  .max(20);

// completeOnboardingSchema removed in Phase 10 — el legacy completeOnboarding
// se eliminó. La Premium Architecture persiste cada step independientemente
// vía updateOnboardingStep, con su propio schema por step. No hay schema
// "completo" — el step 9 (finalizeOnboarding) solo marca onboarding_completed
// y no necesita validar un blob agregado.
