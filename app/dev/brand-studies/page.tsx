import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Folio · Estudios de marca", robots: { index:false, follow:false } };

const options = [
  { id:"stack", name:"Archivo", text:"La marca anterior: tres hojas y una F. Conserva el concepto, pero sus capas se funden en tamaños pequeños." },
  { id:"fold", name:"Hoja clara", text:"Una hoja, un pliegue y una F más abierta. Menos piezas, mejor lectura en la navegación y al imprimir." },
  { id:"ribbon", name:"Continuidad", text:"Dos trazos forman una F abierta. Ligera y expresiva, aunque la relación con la historia clínica es menos directa." },
] as const;
type Direction = typeof options[number]["id"];

function Symbol({ direction, size=72, color="var(--accent)", foreground="#fff" }: { direction:Direction; size?:number; color?:string; foreground?:string }) {
  if (direction === "stack") return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true"><rect x="24" y="8" width="70" height="74" rx="8" fill={color} opacity=".26"/><rect x="15" y="15" width="70" height="74" rx="8" fill={color} opacity=".5"/><path d="M14 22H64L84 42V88Q84 96 76 96H14Q6 96 6 88V30Q6 22 14 22Z" fill={color}/><path d="M64 22L84 42H64Z" fill={foreground} opacity=".22"/><path d="M28 38H59V48H39V58H56V68H39V80H28Z" fill={foreground}/></svg>;
  if (direction === "fold") return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M12 4H29L42 17V36Q42 44 34 44H12Q5 44 5 37V11Q5 4 12 4Z" fill={color}/><path d="M29 4V12Q29 17 34 17H42Z" fill={foreground} opacity=".25"/><path d="M14 15H28V21H20V26H27V32H20V38H14Z" fill={foreground}/></svg>;
  return <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true"><path d="M10 40V16C10 9 15 5 22 5H41V14H23C20 14 19 16 19 19V40Z" fill={color}/><path d="M24 23H38V32H24Z" fill={color} opacity=".56"/></svg>;
}

export default function BrandStudies() {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") notFound();
  return <main className="brand-study"><style>{`
    .brand-study { max-width:1280px; margin:0 auto; padding:64px 40px; color:var(--ink); }
    .brand-study h1 { font-size:36px; letter-spacing:-1.4px; font-weight:600; margin:0 0 16px; }
    .brand-study>p { max-width:650px; font-size:15px; line-height:1.8; color:var(--ink-2); margin-bottom:44px; }
    .brand-study-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; }
    .brand-study article { border:1px solid var(--line); background:var(--surface); border-radius:16px; overflow:hidden; }
    .brand-study-main { height:220px; display:grid; place-items:center; background:#F6F5FC; }
    .brand-study-body { padding:25px; }
    .brand-study h2 { font-size:21px; font-weight:600; margin:0 0 10px; }
    .brand-study article p { font-size:13px; line-height:1.8; color:var(--ink-2); min-height:93px; }
    .brand-study-scale { display:flex; align-items:end; justify-content:space-between; gap:14px; margin:32px 0; }
    .brand-study-scale>div { display:grid; justify-items:center; gap:10px; }
    .brand-study-scale small { font-size:10px; color:var(--ink-3); }
    .brand-study-lockup { display:flex; align-items:center; gap:9px; padding:23px 20px; border-top:1px solid var(--line-soft); }
    .brand-study-lockup>span { font-size:31px; font-weight:750; letter-spacing:-1.5px; line-height:1; }
    .brand-study-dark { background:#22212D; color:#F0EEF7; border:0; }
    .brand-study-ink { color:#292641; }
    @media(max-width:800px) { .brand-study-grid { grid-template-columns:1fr; } .brand-study { padding:32px 20px; } }
  `}</style><h1>Una evolución pequeña de la marca.</h1><p>El símbolo debe leerse en una pestaña de 16 píxeles y acompañar la misma identidad en el consultorio. Tres estudios, probados con y sin color.</p><div className="brand-study-grid">
    {options.map((option) => <article key={option.id}><div className="brand-study-main"><Symbol direction={option.id} size={94}/></div><div className="brand-study-body"><h2>{option.name}</h2><p>{option.text}</p><div className="brand-study-scale">{[16,24,32,48].map((size) => <div key={size}><Symbol direction={option.id} size={size}/><small>{size} px</small></div>)}</div></div><div className="brand-study-lockup"><Symbol direction={option.id} size={30}/><span>folio<span style={{color:"var(--accent)"}}>·</span></span></div><div className="brand-study-lockup brand-study-dark" style={{"--accent":"#B6A9FF"} as CSSProperties}><Symbol direction={option.id} size={30} foreground="#22212D"/><span>folio</span></div><div className="brand-study-lockup brand-study-ink"><Symbol direction={option.id} size={30} color="#292641"/><span>folio</span></div></article>)}
  </div></main>;
}
