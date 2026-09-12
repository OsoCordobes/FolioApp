"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Lock } from "@/components/icons";
import "@/styles/specialty-showcase.css";

const SPECIALTIES = [
  { id: "psicologia", name: "Psicología", title: "Registro de sesión", text: "Sesiones, escalas y seguimiento del proceso terapéutico." },
  { id: "cardiologia", name: "Cardiología", title: "Registro cardiovascular", text: "Signos vitales, factores de riesgo y estudios en una misma ficha." },
  { id: "kinesiologia", name: "Kinesiología", title: "Evolución funcional", text: "Dolor, movilidad y objetivos para seguir cada etapa del tratamiento." },
  { id: "nutricion", name: "Nutrición", title: "Seguimiento nutricional", text: "Mediciones, evolución antropométrica y plan alimentario." },
  { id: "quiropraxia", name: "Quiropraxia", title: "Registro por segmento", text: "Un mapa de segmentos, notas de atención y continuidad entre visitas." },
] as const;

type Specialty = typeof SPECIALTIES[number];
type SpecialtyId = Specialty["id"];

/** Each record is an illustration of existing tools, with wholly fictional data. */
export function SpecialtyShowcase() {
  const [selected, setSelected] = useState<SpecialtyId>("psicologia");
  const [expanded, setExpanded] = useState<SpecialtyId | null>("psicologia");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const specialty = SPECIALTIES.find((item) => item.id === selected)!;

  function select(id: SpecialtyId) {
    setSelected(id);
    setExpanded(id);
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === "ArrowDown") target = (index + 1) % SPECIALTIES.length;
    else if (event.key === "ArrowUp") target = (index + SPECIALTIES.length - 1) % SPECIALTIES.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = SPECIALTIES.length - 1;
    else return;
    event.preventDefault();
    buttons.current[target]?.focus();
  }

  return <div className="fx-specialty-showcase">
    <div className="fx-specialty-choices">
      <div className="fx-specialty-accordion">
        {SPECIALTIES.map((item, index) => <div className="fx-specialty-option" key={item.id} data-selected={selected === item.id}>
          <h3><button type="button" id={`specialty-${item.id}`} aria-expanded={expanded === item.id} aria-controls={`specialty-description-${item.id}`}
            ref={(node) => { buttons.current[index] = node; }} onKeyDown={(event) => moveFocus(event, index)}
            onClick={() => { setSelected(item.id); setExpanded(expanded === item.id ? null : item.id); }}>
            <span>{item.name}</span><ChevronDown size={18} aria-hidden="true" />
          </button></h3>
          <div className="fx-specialty-description" id={`specialty-description-${item.id}`} hidden={expanded !== item.id}>
            <p>{item.text}</p>
          </div>
        </div>)}
      </div>
      <div className="fx-specialty-mobile-choice">
        <label htmlFor="specialty-mobile">Explorá una especialidad</label>
        <div><select id="specialty-mobile" value={selected} onChange={(event) => select(event.target.value as SpecialtyId)} aria-controls="specialty-record">
          {SPECIALTIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select><ChevronDown size={18} aria-hidden="true" /></div>
        <p>{specialty.text}</p>
      </div>
      <p className="fx-specialty-note">Herramientas de registro para acompañar tu criterio profesional.</p>
    </div>
    <figure className="fx-specialty-figure">
      <div className="fx-specialty-record" id="specialty-record" role="region" aria-label={`Ficha de ejemplo de ${specialty.name}`}>
        <div className="fx-specialty-record-bar"><span>Historia clínica</span><Lock size={13} aria-hidden="true" /></div>
        <div className="fx-specialty-record-stage">
        {SPECIALTIES.map((item) => <div className="fx-specialty-record-content" key={item.id} data-visible={selected === item.id} aria-hidden={selected !== item.id}>
          <div className="fx-specialty-record-heading"><div><span>{item.name}</span><h3>{item.title}</h3></div><span className="fx-specialty-avatar" aria-hidden="true">MR</span></div>
          <div className="fx-specialty-patient"><strong>Martina Ríos</strong><span>Paciente de ejemplo</span></div>
          <RecordBody specialty={item.id} />
        </div>)}
        </div>
        <div className="fx-specialty-record-footer"><Lock size={12} aria-hidden="true" /><span>Acceso según permisos</span><span>Folio</span></div>
      </div>
      <figcaption>Ficha ilustrativa. Personas y datos ficticios.</figcaption>
    </figure>
    <span className="sr-only" aria-live="polite" aria-atomic="true">Mostrando ficha de {specialty.name}.</span>
  </div>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div className="fx-specialty-metric"><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;
}

function RecordBody({ specialty }: { specialty: SpecialtyId }) {
  if (specialty === "psicologia") return <div className="fx-specialty-record-body">
    <div className="fx-specialty-session"><span>15 septiembre 2026</span><span>Sesión 08</span></div>
    <div className="fx-specialty-note-card"><h4>Evolución de la sesión</h4><p>Se retoman los temas del encuentro anterior y se registra la evolución del proceso.</p><div className="fx-specialty-note-rule" /><h4>Objetivos de trabajo</h4><p>Revisar los objetivos acordados en el próximo encuentro.</p></div>
    <div className="fx-specialty-tools"><span>Escalas disponibles</span><div><b>PHQ-9</b><b>GAD-7</b></div></div>
  </div>;

  if (specialty === "cardiologia") return <div className="fx-specialty-record-body">
    <div className="fx-specialty-session"><span>15 septiembre 2026</span><span>Control clínico</span></div>
    <div className="fx-specialty-metrics"><Metric label="Presión arterial" value="118/76" unit="mmHg" /><Metric label="Frecuencia cardíaca" value="68" unit="lpm" /></div>
    <div className="fx-specialty-note-card fx-specialty-note-card--small"><h4>Estudios y seguimiento</h4><p>Antecedentes, examen y estudios disponibles para la próxima consulta.</p></div>
    <div className="fx-specialty-tools"><span>Estudios adjuntos</span><div><b>ECG</b><b>Ecocardiograma</b></div></div>
  </div>;

  if (specialty === "kinesiologia") return <div className="fx-specialty-record-body">
    <div className="fx-specialty-session"><span>Seguimiento entre sesiones</span><span>4 registros</span></div>
    <div className="fx-specialty-chart-heading"><span>Dolor registrado · EVA</span><strong>3 <small>/ 10</small></strong></div>
    <MiniChart values={[6, 5, 4, 3]} labels={["Ses. 1", "Ses. 2", "Ses. 3", "Ses. 4"]} />
    <div className="fx-specialty-detail-row"><span>Movilidad registrada</span><strong>Flexión de rodilla · 135°</strong></div>
    <div className="fx-specialty-tools"><span>En esta ficha</span><div><b>Evaluación</b><b>Objetivos</b></div></div>
  </div>;

  if (specialty === "nutricion") return <div className="fx-specialty-record-body">
    <div className="fx-specialty-session"><span>15 septiembre 2026</span><span>Seguimiento</span></div>
    <div className="fx-specialty-metrics fx-specialty-metrics--three"><Metric label="Peso" value="68,4" unit="kg" /><Metric label="Talla" value="1,67" unit="m" /><Metric label="IMC" value="24,5" /></div>
    <div className="fx-specialty-measurements"><div><span>Registro de peso</span><span>kg</span></div>{[["18 agosto", "70,2"], ["1 septiembre", "69,3"], ["15 septiembre", "68,4"]].map(([date, weight]) => <div key={date}><span>{date}</span><strong>{weight}</strong></div>)}</div>
    <div className="fx-specialty-tools"><span>En esta ficha</span><div><b>Circunferencias</b><b>Plan alimentario</b></div></div>
  </div>;

  return <div className="fx-specialty-record-body">
    <div className="fx-specialty-session"><span>15 septiembre 2026</span><span>Registro de visita</span></div>
    <div className="fx-specialty-spine-layout"><div className="fx-specialty-spine" aria-hidden="true">
      <svg viewBox="0 0 94 226" fill="none"><path d="M47 7C28 48 33 73 46 106C59 139 59 173 47 216" stroke="currentColor" strokeWidth="1.5" opacity=".24" />
        {Array.from({ length: 24 }, (_, index) => { const y = 8 + index * 8.4; const x = 36 - Math.sin(index * .28) * 7; const width = 21 + index * .36; return <rect key={index} x={x} y={y} width={width} height="6" rx="2.5" fill="currentColor" opacity={index === 3 || index === 21 ? 1 : .17} />; })}
        <path d="M22 204Q17 220 40 222M70 204Q77 220 54 222" stroke="currentColor" strokeWidth="7" opacity=".17" strokeLinecap="round" />
      </svg></div><div className="fx-specialty-segments"><div><span>Segmento cervical</span><strong>C4</strong><small>Técnica diversificada</small></div><div><span>Segmento lumbar</span><strong>L3</strong><small>Notas de la visita</small></div><p>Un registro visual por segmento.</p></div></div>
    <div className="fx-specialty-tools"><span>En esta ficha</span><div><b>Mapa</b><b>Evolución</b><b>Estudios</b></div></div>
  </div>;
}

function MiniChart({ values, labels }: { values: number[]; labels: string[] }) {
  const points = values.map((value, index) => `${16 + index * 90},${94 - value * 10}`);
  return <div className="fx-specialty-chart"><svg viewBox="0 0 302 114" role="img" aria-label={`Dolor de ejemplo por sesión: ${values.join(", ")} sobre 10.`}>
    {[24, 54, 84].map((y) => <path key={y} d={`M16 ${y}H286`} stroke="var(--line-soft)" strokeDasharray="3 4" />)}
    <polyline points={points.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    {values.map((value, index) => <g key={index}><circle cx={16 + index * 90} cy={94 - value * 10} r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" /><text x={16 + index * 90} y={79 - value * 10} textAnchor="middle" fill="var(--ink-2)" fontSize="10">{value}</text></g>)}
  </svg><div className="fx-specialty-chart-labels">{labels.map((label) => <span key={label}>{label}</span>)}</div></div>;
}
