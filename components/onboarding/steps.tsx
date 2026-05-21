"use client";

/**
 * Folio · Onboarding · Steps 2-8 (premium refactor).
 *
 * Cada step:
 *   - Validación inline (blur + onChange para limpiar errores).
 *   - Recibe `orgId` / `orgSlug` (premium architecture) y los usa donde corresponde.
 *   - Step 3 incluye <SlugEditor /> + bio textarea con contador + smart defaults por rubro.
 *   - StepShell renderiza <CardPreviewLive /> a la derecha (desktop) o vía drawer (mobile).
 *
 * Step 9 vive en step9-moment.tsx (separado por su tamaño + animaciones propias).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { updateOnboardingStep } from "@/app/(public)/onboarding/actions";
import { StepShell } from "@/components/onboarding/step-shell";
import { SlugEditor } from "@/components/onboarding/slug-editor";
import { type CardPreviewData } from "@/components/onboarding/card-preview";
import { LogoUpload } from "@/components/public-card/logo-upload";
import { MoodPicker } from "@/components/public-card/mood-picker";
import { type CardMood } from "@/components/public-card/public-card";
import { getRubroTemplate, listRubros } from "@/lib/onboarding/templates";

// ─── Data shape compartido ──────────────────────────────────────────────────

export interface OnboardingDataState {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  matricula: string;
  tel: string;
  consultorioNombre: string;
  rubro: string;
  direccion: string;
  ciudad: string;
  provincia: string;
  instagram: string;
  /** Teléfono mostrado en /book público. Distinto del tel personal. */
  telefonoPublico: string;
  /** Bio corta del consultorio (max 280 chars). */
  bio: string;
  acento: string;
  /** URL pública del logo PNG (Supabase Storage). NULL → AvatarIniciales fallback. */
  logoUrl: string | null;
  /** Mood elegido por el pro para su card pública. */
  cardMood: CardMood;
  diasActivos: string[];
  franjas: [string, string][];
  slotMin: number;
  servicios: Array<{
    id: number;
    nombre: string;
    dur: number;
    precio: number;
    soloNuevos?: boolean;
    paquete?: boolean;
  }>;
  googleConectado: boolean;
  mpConectado: boolean;
}

export const ONBOARDING_INITIAL: OnboardingDataState = {
  email: "",
  password: "",
  nombre: "",
  apellido: "",
  matricula: "",
  tel: "",
  consultorioNombre: "",
  rubro: "quiropraxia",
  direccion: "",
  ciudad: "",
  provincia: "Córdoba",
  instagram: "",
  telefonoPublico: "",
  bio: "",
  acento: "#8A6722",
  logoUrl: null,
  cardMood: "editorial",
  diasActivos: ["lun", "mar", "mie", "jue", "vie"],
  franjas: [["09:00", "12:00"], ["15:00", "18:00"]],
  slotMin: 45,
  servicios: [
    { id: 1, nombre: "Consulta inicial", dur: 60, precio: 35000, soloNuevos: true },
    { id: 2, nombre: "Seguimiento",      dur: 45, precio: 22000 },
    { id: 3, nombre: "Pack 5 sesiones",  dur: 45, precio: 95000, paquete: true },
  ],
  googleConectado: false,
  mpConectado: false,
};

interface StepProps {
  data: OnboardingDataState;
  set: (patch: Partial<OnboardingDataState>) => void;
  next: () => void;
  back?: () => void;
  skip?: () => void;
  orgId?: string;
  orgSlug?: string;
  direction?: "forward" | "back";
}

// ─── Helpers de validación ──────────────────────────────────────────────────

const TEL_RE = /^[\d\s\-+()]{6,}$/;

function previewDataFor(data: OnboardingDataState): CardPreviewData {
  const fullName = [data.nombre, data.apellido].filter(Boolean).join(" ").trim();
  return {
    nombre: fullName || data.consultorioNombre || undefined,
    consultorioNombre: data.consultorioNombre || undefined,
    rubro: rubroLabel(data.rubro),
    ciudad: data.ciudad || undefined,
    provincia: data.provincia || undefined,
    bio: data.bio || undefined,
    telefonoPublico: data.telefonoPublico || data.tel || undefined,
    instagramHandle: data.instagram || undefined,
    direccionCompleta: data.direccion || undefined,
    acentoHex: data.acento,
    logoUrl: data.logoUrl ?? undefined,
    cardMood: data.cardMood,
    servicios: data.servicios
      .filter((s) => s.nombre.trim())
      .map((s) => ({
        nombre: s.nombre,
        dur: s.dur,
        precioCents: Math.round(s.precio * 100),
      })),
  };
}

function rubroLabel(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const found = listRubros().find((r) => r.id === id);
  return found?.label;
}

// ─── Step 2 · Profesional (con validación inline) ───────────────────────────

export function Step2Profesional({ data, set, next, back, skip, orgSlug }: StepProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingDataState, string>>>({});

  const validate = (field: keyof OnboardingDataState, value: string): string => {
    if (field === "nombre" && !value.trim()) return "Necesitamos tu nombre.";
    if (field === "apellido" && !value.trim()) return "Necesitamos tu apellido.";
    if (field === "tel" && value && !TEL_RE.test(value)) return "Formato no parece teléfono.";
    return "";
  };

  const onBlur = (field: keyof OnboardingDataState) => {
    const value = data[field] as string;
    const msg = validate(field, value ?? "");
    setErrors((prev) => ({ ...prev, [field]: msg || undefined }));
  };

  const canContinue =
    !!data.nombre.trim() &&
    !!data.apellido.trim() &&
    !errors.nombre && !errors.apellido && !errors.tel;

  return (
    <StepShell stepIdx={2} back={back} next={next} skip={skip}
      headline="¿Cómo te llamás?"
      sub="Aparece en el sidebar y en tu link público. Lo cambiás cuando quieras."
      nextDisabled={!canContinue}
      previewData={previewDataFor(data)}
      slug={orgSlug}
    >
      <div className="onb-form">
        <div className="onb-form-row-2">
          <Field label="Nombre" error={errors.nombre}>
            <input type="text" placeholder="Lorenzo"
              value={data.nombre}
              onChange={(e) => { set({ nombre: e.target.value }); if (errors.nombre) setErrors((p) => ({ ...p, nombre: undefined })); }}
              onBlur={() => onBlur("nombre")} />
          </Field>
          <Field label="Apellido" error={errors.apellido}>
            <input type="text" placeholder="Martínez"
              value={data.apellido}
              onChange={(e) => { set({ apellido: e.target.value }); if (errors.apellido) setErrors((p) => ({ ...p, apellido: undefined })); }}
              onBlur={() => onBlur("apellido")} />
          </Field>
        </div>
        <Field label="Matrícula" hint="Formato libre. Si tu consejo usa otro, escribilo igual.">
          <input type="text" placeholder="M.N. ACA 8942"
            value={data.matricula} onChange={(e) => set({ matricula: e.target.value })}/>
        </Field>
        <Field label="Teléfono personal" error={errors.tel}
          hint="Para alertas internas. No se muestra a pacientes.">
          <div className="onb-input-prefix">
            <span className="fm-mono">+54</span>
            <input type="tel" placeholder="9 351 411-2233"
              value={data.tel}
              onChange={(e) => { set({ tel: e.target.value }); if (errors.tel) setErrors((p) => ({ ...p, tel: undefined })); }}
              onBlur={() => onBlur("tel")} />
          </div>
        </Field>
      </div>
    </StepShell>
  );
}

// ─── Step 3 · Consultorio (SlugEditor + bio + smart defaults) ───────────────

export function Step3Consultorio({ data, set, next, back, skip, orgId, orgSlug }: StepProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof OnboardingDataState, string>>>({});
  const [draftSlug, setDraftSlug] = useState<string>(orgSlug ?? "");
  const rubros = useMemo(() => listRubros(), []);

  useEffect(() => {
    if (orgSlug) setDraftSlug(orgSlug);
  }, [orgSlug]);

  const onBlur = (field: keyof OnboardingDataState) => {
    const value = (data[field] as string) ?? "";
    let msg = "";
    if (field === "consultorioNombre" && !value.trim()) msg = "Dale un nombre al consultorio.";
    if (field === "ciudad" && !value.trim()) msg = "¿En qué ciudad atendés?";
    if (field === "bio" && value.length > 280) msg = "Máximo 280 caracteres.";
    setErrors((prev) => ({ ...prev, [field]: msg || undefined }));
  };

  /**
   * Cuando el user cambia el rubro, aplicamos smart defaults SOLO en campos
   * vacíos (no pisamos lo que ya escribió). La bio se sugiere solo si está
   * vacía Y hay ciudad disponible.
   */
  const onRubroChange = (newRubro: string) => {
    set({ rubro: newRubro });
    const tpl = getRubroTemplate(newRubro);
    const patch: Partial<OnboardingDataState> = {};

    if (!data.bio.trim() && data.ciudad.trim()) {
      patch.bio = tpl.bioTemplate(data.ciudad);
    }
    // Solo aplicamos defaults de servicios/horarios si user no los modificó (compare con initial)
    const isDefaultServicios = data.servicios.length === 3 &&
      data.servicios[0]?.nombre === "Consulta inicial";
    if (isDefaultServicios && tpl.servicios.length > 0) {
      patch.servicios = tpl.servicios.map((s, i) => ({
        id: Date.now() + i,
        nombre: s.nombre,
        dur: s.dur,
        precio: s.precioCents / 100,
      }));
    }
    const isDefaultHorarios =
      data.diasActivos.length === 5 &&
      data.franjas.length === 2 &&
      data.franjas[0]?.[0] === "09:00" &&
      data.slotMin === 45;
    if (isDefaultHorarios) {
      patch.diasActivos = tpl.horarios.diasActivos;
      patch.franjas = tpl.horarios.franjas;
      patch.slotMin = tpl.horarios.slotMin;
    }

    if (Object.keys(patch).length > 0) set(patch);
  };

  const onSlugChange = useCallback((slug: string) => {
    setDraftSlug(slug);
  }, []);

  // Cuando el user avanza, persiste slug si cambió
  const handleNext = async () => {
    if (draftSlug && draftSlug !== orgSlug) {
      try {
        const res = await updateOnboardingStep(3, {
          consultorioNombre: data.consultorioNombre,
          rubro: data.rubro,
          ciudad: data.ciudad,
          provincia: data.provincia,
          direccion: data.direccion,
          telefonoPublico: data.telefonoPublico,
          instagram: data.instagram,
          bio: data.bio,
          slugManual: draftSlug,
        });
        if (!res.ok) {
          setErrors((p) => ({ ...p, consultorioNombre: res.error ?? "No pude guardar el link." }));
          return;
        }
      } catch {
        // ignore — auto-save lo va a reintentar
      }
    }
    next();
  };

  const canContinue =
    !!data.consultorioNombre.trim() &&
    !!data.ciudad.trim() &&
    !errors.consultorioNombre &&
    !errors.ciudad &&
    !errors.bio;

  const bioCount = data.bio.length;
  const bioOverLimit = bioCount > 280;

  return (
    <StepShell stepIdx={3} back={back} next={handleNext} skip={skip}
      headline="¿Dónde está tu consultorio?"
      sub="Esta info aparece en tu link público de reservas."
      nextDisabled={!canContinue}
      previewData={previewDataFor(data)}
      slug={draftSlug || orgSlug}
    >
      <div className="onb-form">
        <Field label="Nombre del consultorio" error={errors.consultorioNombre}
          hint="Puede ser tu nombre o uno comercial.">
          <input type="text" placeholder="Consultorio Lorenzo Martínez"
            value={data.consultorioNombre}
            onChange={(e) => { set({ consultorioNombre: e.target.value }); if (errors.consultorioNombre) setErrors((p) => ({ ...p, consultorioNombre: undefined })); }}
            onBlur={() => onBlur("consultorioNombre")} />
        </Field>

        <Field label="Rubro">
          <select value={data.rubro} onChange={(e) => onRubroChange(e.target.value)}>
            {rubros.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Tu link público">
          <SlugEditor
            value={draftSlug || orgSlug || ""}
            onChange={onSlugChange}
            baseSuggestion={`${slugifyClient(data.nombre)}-${slugifyClient(data.apellido)}`.replace(/^-|-$/g, "")}
            currentOrgId={orgId}
          />
        </Field>

        <Field label="Dirección">
          <input type="text" placeholder="Belgrano 234"
            value={data.direccion} onChange={(e) => set({ direccion: e.target.value })}/>
        </Field>
        <div className="onb-form-row-2">
          <Field label="Ciudad" error={errors.ciudad}>
            <input type="text" placeholder="Alta Gracia"
              value={data.ciudad}
              onChange={(e) => { set({ ciudad: e.target.value }); if (errors.ciudad) setErrors((p) => ({ ...p, ciudad: undefined })); }}
              onBlur={() => onBlur("ciudad")} />
          </Field>
          <Field label="Provincia">
            <select value={data.provincia} onChange={(e) => set({ provincia: e.target.value })}>
              {["Córdoba","Buenos Aires","Santa Fe","Mendoza","Neuquén","Salta","Tucumán","Río Negro","Entre Ríos","Misiones","Otra"].map(p =>
                <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Teléfono del consultorio" hint="El que aparece en tu link público (puede ser distinto al personal).">
          <div className="onb-input-prefix">
            <span className="fm-mono">+54</span>
            <input type="tel" placeholder="9 351 411-2233"
              value={data.telefonoPublico}
              onChange={(e) => set({ telefonoPublico: e.target.value })} />
          </div>
        </Field>

        <Field label="Instagram" hint="Opcional. Aparece como link en tu card pública.">
          <div className="onb-input-prefix">
            <span className="fm-mono">@</span>
            <input type="text" placeholder="lorenzo.quiropraxia"
              value={data.instagram} onChange={(e) => set({ instagram: e.target.value.replace(/^@/, "") })}/>
          </div>
        </Field>

        <Field label="Descripción corta" error={errors.bio}
          hint={`Una o dos oraciones. Aparece en tu card pública.`}>
          <textarea
            placeholder={data.ciudad ? `Quiropráctica y bienestar postural en ${data.ciudad}.` : "Quiropráctica y bienestar postural."}
            value={data.bio}
            rows={3}
            maxLength={320}
            onChange={(e) => { set({ bio: e.target.value }); if (errors.bio) setErrors((p) => ({ ...p, bio: undefined })); }}
            onBlur={() => onBlur("bio")}
            style={{ resize: "vertical", minHeight: 72 }}
          />
          <span className={`onb-counter ${bioOverLimit ? "is-over" : ""}`} aria-live="polite">
            {bioCount} / 280
          </span>
        </Field>
      </div>
    </StepShell>
  );
}

// ─── Step 4 · Identidad visual (logo + acento + mood) ──────────────────────

const ACENTOS_CURADOS = [
  { id: "#8A6722", nombre: "Brass",         desc: "Cálido, sobrio" },
  { id: "#3F6B49", nombre: "Verde antiguo", desc: "Sereno, clínico" },
  { id: "#3F5E75", nombre: "Azul piedra",   desc: "Sólido, neutral" },
  { id: "#A8513A", nombre: "Terracota",     desc: "Cálido, presente" },
];

export function Step4Personalizacion({ data, set, next, back, skip, orgSlug }: StepProps) {
  return (
    <StepShell stepIdx={4} back={back} next={next} skip={skip}
      headline="Tu identidad visual"
      sub="Cómo se ve tu link público: logo, color y estilo. Lo cambiás cuando quieras."
      previewData={previewDataFor(data)}
      slug={orgSlug}
    >
      <div className="onb-form">
        <section className="onb-identity-section">
          <h2 className="onb-identity-h">Logo</h2>
          <p className="onb-identity-hint">
            Opcional. Si lo subís, reemplaza el avatar de iniciales en tu card.
          </p>
          <LogoUpload
            currentLogoUrl={data.logoUrl}
            onUploaded={(url) => set({ logoUrl: url })}
            onRemoved={() => set({ logoUrl: null })}
          />
        </section>

        <section className="onb-identity-section">
          <h2 className="onb-identity-h">Color de acento</h2>
          <p className="onb-identity-hint">
            Aparece en CTAs, tu mark, y la card pública. (En el mood Clínico se
            atempera hacia ink-blue para preservar el registro clínico.)
          </p>
          <div className="onb-acentos">
            {ACENTOS_CURADOS.map(a => {
              const isActive = data.acento === a.id;
              return (
                <button key={a.id} type="button"
                  className={"onb-acento " + (isActive ? "is-active" : "")}
                  onClick={() => set({ acento: a.id })}>
                  <div className="onb-acento-preview">
                    <div className="onb-acento-chart">
                      {[40, 65, 88, 72, 95, 60, 80].map((h, i) => (
                        <span key={i} className="onb-chart-bar"
                          style={{ height: h + "%", background: i === 4 ? a.id : `${a.id}33` }}/>
                      ))}
                    </div>
                    <div className="onb-acento-cta" style={{ background: a.id }}>Confirmar</div>
                  </div>
                  <div className="onb-acento-meta">
                    <span className="onb-acento-swatch" style={{ background: a.id }}/>
                    <div>
                      <b>{a.nombre}</b>
                      <span>{a.desc}</span>
                    </div>
                    {isActive ? (
                      <span className="onb-acento-check">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="onb-identity-section">
          <h2 className="onb-identity-h">Estilo de tu card</h2>
          <p className="onb-identity-hint">
            Define la tipografía, el contraste y la decoración. Elegí el que más
            se parezca a tu práctica.
          </p>
          <MoodPicker
            value={data.cardMood}
            onChange={(mood) => set({ cardMood: mood })}
          />
        </section>
      </div>
    </StepShell>
  );
}

// ─── Step 5 · Horarios ──────────────────────────────────────────────────────

const DIAS_SEM = [
  { id: "lun", lbl: "Lun" },
  { id: "mar", lbl: "Mar" },
  { id: "mie", lbl: "Mié" },
  { id: "jue", lbl: "Jue" },
  { id: "vie", lbl: "Vie" },
  { id: "sab", lbl: "Sáb" },
  { id: "dom", lbl: "Dom" },
];

export function Step5Horarios({ data, set, next, back, skip, orgSlug }: StepProps) {
  const toggleDia = (id: string) => {
    const s = new Set(data.diasActivos);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    set({ diasActivos: Array.from(s) });
  };
  const setFranja = (i: number, idx: 0 | 1, val: string) => {
    const updated = data.franjas.map((f, k) =>
      k === i ? (f.map((v, j) => (j === idx ? val : v)) as [string, string]) : f,
    );
    set({ franjas: updated });
  };
  const addFranja = () => set({ franjas: [...data.franjas, ["", ""]] });
  const removeFranja = (i: number) => set({ franjas: data.franjas.filter((_, k) => k !== i) });

  const canContinue = data.diasActivos.length > 0 && data.franjas.every(([a, b]) => a && b);

  return (
    <StepShell stepIdx={5} back={back} next={next} skip={skip}
      headline="¿Cuándo atendés?"
      sub="Los pacientes solo van a ver slots disponibles dentro de estos horarios."
      nextDisabled={!canContinue}
      previewData={previewDataFor(data)}
      slug={orgSlug}
    >
      <div className="onb-form">
        <div className="onb-field">
          <span>Días</span>
          <div className="onb-dias">
            {DIAS_SEM.map(d => {
              const isOn = data.diasActivos.includes(d.id);
              return (
                <button key={d.id} type="button"
                  className={"onb-dia " + (isOn ? "is-on" : "")}
                  onClick={() => toggleDia(d.id)}>{d.lbl}</button>
              );
            })}
          </div>
        </div>
        <div className="onb-field">
          <span>Franjas horarias</span>
          <div className="onb-franjas">
            {data.franjas.map((f, i) => (
              <div key={i} className="onb-franja">
                <input type="time" value={f[0]} onChange={(e) => setFranja(i, 0, e.target.value)}/>
                <span className="muted">a</span>
                <input type="time" value={f[1]} onChange={(e) => setFranja(i, 1, e.target.value)}/>
                {data.franjas.length > 1 ? (
                  <button type="button" className="onb-franja-remove"
                    onClick={() => removeFranja(i)} aria-label="Quitar franja">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                ) : null}
              </div>
            ))}
            <button type="button" className="onb-link-add" onClick={addFranja}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Agregar franja
            </button>
          </div>
        </div>
        <label className="onb-field">
          <span>Duración por slot</span>
          <select value={data.slotMin} onChange={(e) => set({ slotMin: Number(e.target.value) })}>
            <option value={30}>30 minutos</option>
            <option value={45}>45 minutos</option>
            <option value={60}>60 minutos</option>
          </select>
        </label>
      </div>
    </StepShell>
  );
}

// ─── Step 6 · Servicios ─────────────────────────────────────────────────────

export function Step6Servicios({ data, set, next, back, skip, orgSlug }: StepProps) {
  const setServ = (i: number, patch: Partial<OnboardingDataState["servicios"][number]>) =>
    set({ servicios: data.servicios.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const addServ = () =>
    set({ servicios: [...data.servicios, { id: Date.now(), nombre: "", dur: 45, precio: 0 }] });
  const removeServ = (i: number) =>
    set({ servicios: data.servicios.filter((_, k) => k !== i) });

  const canContinue =
    data.servicios.length > 0 &&
    data.servicios.every((s) => s.nombre.trim() && s.dur > 0 && s.precio >= 0);

  return (
    <StepShell stepIdx={6} back={back} next={next} skip={skip}
      headline="¿Qué servicios ofrecés?"
      sub="Los pacientes ven esta lista al reservar. Editable después en Configuración."
      nextDisabled={!canContinue}
      previewData={previewDataFor(data)}
      slug={orgSlug}
    >
      <div className="onb-servicios">
        {data.servicios.map((s, i) => (
          <div key={s.id} className="onb-servicio-row">
            <input className="onb-serv-name" type="text" value={s.nombre}
              placeholder="Nombre del servicio"
              onChange={(e) => setServ(i, { nombre: e.target.value })}/>
            <div className="onb-serv-num">
              <input type="number" value={s.dur} step={15} min={15}
                onChange={(e) => setServ(i, { dur: Number(e.target.value) })}/>
              <span className="fm-mono">min</span>
            </div>
            <div className="onb-serv-num">
              <span className="fm-mono">$</span>
              <input type="number" value={s.precio} step={1000} min={0}
                onChange={(e) => setServ(i, { precio: Number(e.target.value) })}/>
            </div>
            <button type="button" className="onb-serv-remove"
              onClick={() => removeServ(i)} aria-label="Quitar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        ))}
        <button type="button" className="onb-link-add" onClick={addServ}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Agregar servicio
        </button>
      </div>
    </StepShell>
  );
}

// ─── Step 7 · Google Calendar ──────────────────────────────────────────────

export function Step7Google({ data, set, next, back, skip, orgSlug }: StepProps) {
  return (
    <StepShell stepIdx={7} back={back} next={next} skip={skip}
      headline="¿Conectamos tu Google Calendar?"
      sub="Los eventos personales que crees en Google bloquean slots automáticamente. Las reservas confirmadas se sincronizan a tu calendar."
      previewData={previewDataFor(data)}
      slug={orgSlug}
    >
      <div className="onb-integration">
        <button type="button" className="onb-oauth-card"
          onClick={() => { set({ googleConectado: true }); next(); }}>
          <div className="onb-oauth-ico">
            <svg width="32" height="32" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </div>
          <div className="onb-oauth-body">
            <b>Conectar Google Calendar</b>
            <p>Pedimos permiso para leer y crear eventos en tu calendar primario.</p>
          </div>
          <div className="onb-oauth-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
        </button>
        <p className="onb-fine">
          Tus datos del calendar quedan privados. Solo leemos eventos para bloquear slots; no se comparten con pacientes.
        </p>
      </div>
    </StepShell>
  );
}

// ─── Step 8 · Mercado Pago ──────────────────────────────────────────────────

export function Step8MercadoPago({ data, next, back, skip, orgSlug }: StepProps) {
  return (
    <StepShell stepIdx={8} back={back} next={next} skip={skip}
      headline="Activá tu prueba"
      sub="Tenés 7 días gratis sin tarjeta. Después, activás tu suscripción desde Configuración cuando estés listo para cobrar."
      previewData={previewDataFor(data)}
      slug={orgSlug}
    >
      <div className="onb-integration">
        <div className="onb-trial-card">
          <div className="onb-trial-row">
            <div className="onb-trial-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <b>Tu prueba arranca ya</b>
              <p>7 días para probar todas las funciones. Sin compromiso, sin tarjeta.</p>
            </div>
          </div>
          <div className="onb-trial-row">
            <div className="onb-trial-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <div>
              <b>Cuando quieras, ARS 35.000 / mes</b>
              <p>Suscripción mensual via Mercado Pago. Cancelás cuando quieras desde Configuración.</p>
            </div>
          </div>
        </div>
        <p className="onb-fine">
          Mientras tanto, los pacientes pueden reservar libremente. Cuando actives tu cuenta MP, también podrás cobrar online.
        </p>
      </div>
    </StepShell>
  );
}

// ─── Field helper ──────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={"onb-field" + (error ? " is-err" : "")}>
      <span>{label}</span>
      {children}
      {error ? <span className="onb-err">{error}</span> : hint ? <span className="onb-hint">{hint}</span> : null}
    </label>
  );
}

function slugifyClient(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
