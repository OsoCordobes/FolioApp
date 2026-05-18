"use client";

/**
 * Folio · Onboarding · Steps 2-9 (los 8 pasos siguientes a Registro).
 *
 * Port fiel de folio/onboarding-steps.jsx (líneas 100-516). Step 1
 * (Registro) vive en `step1-registro.tsx` y conecta con `signUpEmail`.
 * El Step 9 conecta con `completeOnboarding`.
 */

import { useState } from "react";

import { StepShell } from "@/components/onboarding/step-shell";
import { FolioMark } from "@/components/folio-mark";

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
  acento: string;
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
  acento: "#8A6722",
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
}

// ─── Step 2 · Profesional ───────────────────────────────────────────────────

export function Step2Profesional({ data, set, next, back, skip }: StepProps) {
  return (
    <StepShell stepIdx={2} back={back} next={next} skip={skip}
      headline="¿Cómo te llamás?"
      sub="Este es el nombre que va a aparecer en el sidebar y en tu link público.">
      <div className="onb-form">
        <div className="onb-form-row-2">
          <label className="onb-field">
            <span>Nombre</span>
            <input type="text" placeholder="Lorenzo"
              value={data.nombre} onChange={(e) => set({ nombre: e.target.value })}/>
          </label>
          <label className="onb-field">
            <span>Apellido</span>
            <input type="text" placeholder="Martínez"
              value={data.apellido} onChange={(e) => set({ apellido: e.target.value })}/>
          </label>
        </div>
        <label className="onb-field">
          <span>Matrícula</span>
          <input type="text" placeholder="M.N. ACA 8942"
            value={data.matricula} onChange={(e) => set({ matricula: e.target.value })}/>
          <span className="onb-hint">Formato libre. Algunos consejos usan otros formatos viejos.</span>
        </label>
        <label className="onb-field">
          <span>Teléfono</span>
          <div className="onb-input-prefix">
            <span className="fm-mono">+54</span>
            <input type="tel" placeholder="9 351 411-2233"
              value={data.tel} onChange={(e) => set({ tel: e.target.value })}/>
          </div>
        </label>
      </div>
    </StepShell>
  );
}

// ─── Step 3 · Consultorio ───────────────────────────────────────────────────

export function Step3Consultorio({ data, set, next, back, skip }: StepProps) {
  return (
    <StepShell stepIdx={3} back={back} next={next} skip={skip}
      headline="¿Dónde está tu consultorio?"
      sub="Lo usamos para mostrar la dirección en tu link público y los recordatorios.">
      <div className="onb-form">
        <label className="onb-field">
          <span>Nombre del consultorio</span>
          <input type="text" placeholder="Consultorio Lorenzo Martínez"
            value={data.consultorioNombre} onChange={(e) => set({ consultorioNombre: e.target.value })}/>
          <span className="onb-hint">Puede ser tu nombre o uno comercial.</span>
        </label>
        <label className="onb-field">
          <span>Dirección</span>
          <input type="text" placeholder="Belgrano 234"
            value={data.direccion} onChange={(e) => set({ direccion: e.target.value })}/>
        </label>
        <div className="onb-form-row-2">
          <label className="onb-field">
            <span>Ciudad</span>
            <input type="text" placeholder="Alta Gracia"
              value={data.ciudad} onChange={(e) => set({ ciudad: e.target.value })}/>
          </label>
          <label className="onb-field">
            <span>Provincia</span>
            <select value={data.provincia} onChange={(e) => set({ provincia: e.target.value })}>
              {["Córdoba","Buenos Aires","Santa Fe","Mendoza","Neuquén","Salta","Tucumán","Otra"].map(p =>
                <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <label className="onb-field">
          <span>Instagram <small>opcional</small></span>
          <div className="onb-input-prefix">
            <span className="fm-mono">@</span>
            <input type="text" placeholder="lorenzo.quiropraxia"
              value={data.instagram} onChange={(e) => set({ instagram: e.target.value })}/>
          </div>
        </label>
      </div>
    </StepShell>
  );
}

// ─── Step 4 · Personalización (acento) ──────────────────────────────────────

const ACENTOS_CURADOS = [
  { id: "#8A6722", nombre: "Brass",        desc: "Cálido, sobrio" },
  { id: "#3F6B49", nombre: "Verde antiguo", desc: "Sereno, clínico" },
  { id: "#3F5E75", nombre: "Azul piedra",   desc: "Sólido, neutral" },
  { id: "#A8513A", nombre: "Terracota",     desc: "Cálido, presente" },
];

export function Step4Personalizacion({ data, set, next, back, skip }: StepProps) {
  return (
    <StepShell stepIdx={4} back={back} next={next} skip={skip}
      headline="¿Con qué color te identificás?"
      sub="Aparece en CTAs, gráficos y el mark de tu consultorio. Lo cambiás cuando quieras en Configuración.">
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

export function Step5Horarios({ data, set, next, back, skip }: StepProps) {
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

  return (
    <StepShell stepIdx={5} back={back} next={next} skip={skip}
      headline="¿Cuándo atendés?"
      sub="Lo usamos para mostrar los slots disponibles en tu link público.">
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

export function Step6Servicios({ data, set, next, back, skip }: StepProps) {
  const setServ = (i: number, patch: Partial<OnboardingDataState["servicios"][number]>) =>
    set({ servicios: data.servicios.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const addServ = () =>
    set({ servicios: [...data.servicios, { id: Date.now(), nombre: "", dur: 45, precio: 0 }] });
  const removeServ = (i: number) =>
    set({ servicios: data.servicios.filter((_, k) => k !== i) });

  return (
    <StepShell stepIdx={6} back={back} next={next} skip={skip}
      headline="¿Qué servicios ofrecés?"
      sub="Los pacientes ven esta lista al reservar. Editable después en Configuración.">
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

export function Step7Google({ data, set, next, back, skip }: StepProps) {
  void data;
  return (
    <StepShell stepIdx={7} back={back} next={next} skip={skip}
      headline="¿Conectamos tu Google Calendar?"
      sub="Los eventos personales que crees en Google bloquean slots automáticamente. Las reservas confirmadas aparecen en tu Google.">
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
            <p>Vamos a pedir permiso para leer y crear eventos en tu calendar primario.</p>
          </div>
          <div className="onb-oauth-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
        </button>
        <p className="onb-fine">
          Tus datos del calendar quedan privados. Solo leemos los eventos para bloquear slots; no se comparten con pacientes.
        </p>
      </div>
    </StepShell>
  );
}

// ─── Step 8 · Mercado Pago ──────────────────────────────────────────────────

export function Step8MercadoPago({ data, set, next, back, skip }: StepProps) {
  void data;
  return (
    <StepShell stepIdx={8} back={back} next={next} skip={skip}
      headline="¿Conectamos Mercado Pago?"
      sub="Los pacientes pagan online al reservar y los turnos aparecen ya cobrados. Si saltás, cobrás en consultorio.">
      <div className="onb-integration">
        <button type="button" className="onb-oauth-card"
          onClick={() => { set({ mpConectado: true }); next(); }}>
          <div className="onb-oauth-ico" style={{ background: "#009EE3" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
              <path d="M3 9.5C3 7.6 4.6 6 6.5 6h11C19.4 6 21 7.6 21 9.5v5c0 1.9-1.6 3.5-3.5 3.5h-11C4.6 18 3 16.4 3 14.5v-5z" fill="#fff"/>
              <circle cx="12" cy="12" r="2.2" fill="#009EE3"/>
            </svg>
          </div>
          <div className="onb-oauth-body">
            <b>Conectar Mercado Pago</b>
            <p>Suscripciones recurrentes + cobros únicos de sesiones. Comisión MP estándar.</p>
          </div>
          <div className="onb-oauth-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </div>
        </button>
        <p className="onb-fine">
          Si saltás, podés conectarlo después desde Configuración. Igual podés cargar pagos manualmente.
        </p>
      </div>
    </StepShell>
  );
}

// ─── Step 9 · Listo ─────────────────────────────────────────────────────────

interface Step9Props {
  data: OnboardingDataState;
  accent: string;
  onFinish: () => Promise<void> | void;
  finishing?: boolean;
  error?: string | null;
}

export function Step9Listo({ data, accent, onFinish, finishing, error }: Step9Props) {
  const slugBase = (data.nombre || "lorenzo").toLowerCase().replace(/\s+/g, "-") +
                   "-" + (data.apellido || "martinez").toLowerCase().replace(/\s+/g, "-");
  const url = `folio.app/${slugBase}`;
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText("https://" + url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="onb-step onb-listo">
      <div className="onb-listo-mark">
        <FolioMark size={56} color={accent} fg="#FBF9F4" />
      </div>
      <h1>Todo listo.</h1>
      <p className="onb-listo-sub">
        Tu consultorio está configurado. Compartí tu link público para empezar
        a recibir reservas, o agendá manualmente desde el panel.
      </p>

      <div className="onb-listo-link">
        <span className="fi-eyebrow">Tu link de reservas</span>
        <div className="onb-listo-link-row">
          <span className="onb-listo-url fm-mono">{url}</span>
          <button type="button" className="fi-btn fi-btn-secondary" onClick={onCopy}>
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>

      {error ? <p className="au-err">{error}</p> : null}

      <button type="button"
        className="fi-btn fi-btn-primary onb-listo-cta"
        onClick={() => void onFinish()}
        disabled={finishing}>
        {finishing ? "Creando consultorio..." : "Ir al panel"}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    </div>
  );
}
