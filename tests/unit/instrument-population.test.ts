import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "../../lib/instrumentos/population-policy";
import { readInstrumentPopulation } from "../../lib/db/instrument-population";
import {
  bandaSCORE2,
  scoreCHA2DS2VASc,
  scoreHASBLED,
} from "../../lib/especialidades/cardiologia/scores";

const requireActual = createRequire(import.meta.url);
function load(file: string, overrides: Record<string, unknown> = {}) {
  // VM boundary is intentionally dynamic; production module types are checked by tsc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exports: Record<string, (...args: any[]) => any> = {};
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    Date,
    JSON,
    process: { env: {} },
    require: (name: string) =>
      name in overrides
        ? overrides[name]
        : requireActual(
            name.startsWith("@/")
              ? path.resolve(name.slice(2))
              : name.startsWith(".")
                ? path.resolve(path.dirname(file), name)
                : name,
          ),
  });
  return exports;
}
const id = "10500000-0000-4000-8000-000000000001";
const org = "10500000-0000-4000-8000-000000000002";
const encounter = "2026-09-08T15:00:00Z";
const dObs = ["2014-09-08", "2012-09-08", "2010-09-08", "2009-09-08", null];

function fixture(
  dob: string | null,
  {
    existing = null,
    specialty = "psicologia",
    error = false,
  }: { existing?: unknown; specialty?: string; error?: boolean } = {},
) {
  const writes: Record<string, unknown>[] = [];
  const reads: Array<[string, string, unknown]> = [];
  const rows: Record<string, unknown> = {
    paciente: { id, identidad: { fecha_nacimiento: dob, deleted_at: null } },
    turno: {
      organization_id: org,
      paciente_id: id,
      profesional_id: null,
      inicio: encounter,
    },
    organization: { especialidad: specialty },
    sesion: existing?{...(existing as Record<string,unknown>),revision:1}:null,
  };
  const client = {
    rpc:async(_name:string,args:Record<string,unknown>)=>{
      if(args.p_data===null)return {data:null,error:null};
      writes.push(args.p_data as Record<string,unknown>);
      return {data:{id,revision:Number(args.p_expected_revision)+1,updatedAt:encounter,closed:false,operationId:args.p_operation},error:null};
    },
    from: (table: string) => {
      let mutation = false;
      const answer = () => ({
        data: mutation ? { id } : rows[table],
        error:
          error && table === "paciente"
            ? { message: "SECRET_PATIENT_PROVIDER_DETAIL" }
            : null,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fluent query test double
      const q: any = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          reads.push([table, key, value]);
          return q;
        },
        is: (key: string, value: unknown) => {
          reads.push([table, key, value]);
          return q;
        },
        maybeSingle: async () => answer(),
        single: async () => answer(),
        insert: (payload: Record<string, unknown>) => {
          mutation = true;
          writes.push(payload);
          return q;
        },
        update: (payload: Record<string, unknown>) => {
          mutation = true;
          writes.push(payload);
          return q;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(answer()).then(resolve),
      };
      return q;
    },
  };
  const dependencies = {
    "@/lib/crypto": {
      encryptColumn: (v: unknown) => (v == null ? null : `synthetic:${v}`),
      tryDecrypt: (v: string | null) => v?.replace(/^synthetic:/, "") ?? null,
    },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => client },
    "./session": {
      getActiveSession: async () => ({
        ok: true,
        data: { organizationId: org, memberId: id },
      }),
    },
    "./enmiendas": {
      readEnmiendas: async () => ({ ok: true, data: new Map() }),
    },
  };
  return {
    client,
    writes,
    reads,
    rows,
    save: load("lib/db/instrumentos.ts", dependencies).saveRespuesta,
    upsert: (input:Record<string,unknown>)=>load("lib/db/sesiones.ts", dependencies).upsertSesion({...input,revisionEsperada:rows.sesion?1:0,operacionId:id,intencion:"SAVE"}),
  };
}

test("population policy is an operational restriction, not clinical validation", () => {
  assert.equal(
    policy.INSTRUMENT_POPULATION_POLICY.clinicalValidation,
    "pending-professional-review",
  );
  for (const fechaNacimiento of [
    ...dObs,
    "2026-09-09",
    "2026-02-30",
    "invalid",
  ]) {
    assert.equal(
      policy.instrumentPopulationEligibility({
        fechaNacimiento,
        fechaAtencion: encounter,
      }).allowed,
      false,
    );
  }
  assert.equal(
    policy.instrumentPopulationEligibility({
      fechaNacimiento: "2008-09-08",
      fechaAtencion: encounter,
    }).allowed,
    true,
  );
  assert.equal(
    policy.instrumentPopulationEligibility({ fechaNacimiento: "2000-01-01" })
      .allowed,
    false,
  );
  assert.equal(
    policy.instrumentPopulationEligibility({
      fechaNacimiento: "2008-09-09",
      fechaAtencion: "2026-09-09T02:59:00Z",
    }).allowed,
    false,
  );
  assert.equal(
    policy.instrumentPopulationEligibility({
      fechaNacimiento: "2008-09-09",
      fechaAtencion: "2026-09-09T03:00:00Z",
    }).allowed,
    true,
  );
});

test("server population reads actual identity and tenant, sanitizes lookup failure", async () => {
  const f = fixture("2014-09-08");
  const result = await readInstrumentPopulation(
    f.client as never,
    id,
    org,
    encounter,
  );
  assert.ok(result.ok && !result.data.allowed);
  assert.ok(
    f.reads.some(
      ([table, key, value]) =>
        table === "paciente" && key === "organization_id" && value === org,
    ),
  );
  const failure = await readInstrumentPopulation(
    fixture(null, { error: true }).client as never,
    id,
    org,
    encounter,
  );
  assert.equal(failure.ok, false);
  assert.ok(
    !JSON.stringify(failure).includes("SECRET_PATIENT_PROVIDER_DETAIL"),
  );
  const future = await readInstrumentPopulation(
    fixture("2100-01-01").client as never,
    id,
    org,
    "2150-01-01",
  );
  assert.ok(future.ok && !future.data.allowed);
});

for (const dob of dObs) {
  test(`direct instrument writer blocks ${dob ?? "missing DOB"} before encryption or persistence`, async () => {
    const f = fixture(dob);
    f.rows.sesion = { paciente_id: id, turno: { inicio: encounter } };
    const result = await f.save({
      pacienteId: id,
      sesionId: id,
      instrumentoId: "phq9.v1",
      respuestas: Array(9).fill(0),
      edad: 30,
      fechaNacimiento: "1990-01-01",
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /menores de 18/);
    assert.equal(f.writes.length, 0);
  });
  test(`direct session writer blocks new classifications for ${dob ?? "missing DOB"}, permits narrative/crisis care`, async () => {
    const f = fixture(dob);
    const blocked = await f.upsert({
      turnoId: id,
      pacienteId: id,
      toolData: { v: 3, phq9: Array(9).fill(0) },
    });
    assert.equal(blocked.ok, false);
    assert.equal(f.writes.length, 0);
    const narrative = await f.upsert({
      turnoId: id,
      pacienteId: id,
      soap: { s: "Synthetic narrative" },
      toolData: {
        v: 3,
        registro: { riesgo: "plan", nota: "Synthetic clinical assessment" },
      },
    });
    assert.equal(narrative.ok, true);
    assert.equal(f.writes.length, 1);
  });
}

test("known adult can persist an instrument, historical encounter age overrides present adult age", async () => {
  for (const [dob, at, allowed] of [
    ["1990-01-01", encounter, true],
    ["2000-01-01", "2014-01-01T15:00:00Z", false],
  ] as const) {
    const f = fixture(dob);
    f.rows.sesion = { paciente_id: id, turno: { inicio: at } };
    assert.equal(
      (
        await f.save({
          pacienteId: id,
          sesionId: id,
          instrumentoId: "phq9.v1",
          respuestas: Array(9).fill(0),
        })
      ).ok,
      allowed,
    );
    assert.equal(f.writes.length, allowed ? 1 : 0);
  }
});

test("SOAP-only revision preserves omitted legacy notes and EVA; explicit empty values still clear", async () => {
  const f=fixture("1990-01-01",{existing:{id,locked_at:null,tool_id:null,tool_data_cifrado:null,vertebras_json:[],notas_cifrado:"synthetic:prior note",eva_antes:7,eva_despues:2}});
  assert.equal((await f.upsert({turnoId:id,pacienteId:id,soap:{s:"new SOAP"}})).ok,true);
  for(const key of ["notas_cifrado","eva_antes","eva_despues"])assert.ok(!(key in f.writes[0]),`omitted ${key} must not erase prior content`);
  assert.equal((await f.upsert({turnoId:id,pacienteId:id,soap:{s:"new SOAP"},notas:"",evaAntes:null,evaDespues:null})).ok,true);
  assert.equal(f.writes[1].notas_cifrado,"synthetic:");assert.equal(f.writes[1].eva_antes,null);assert.equal(f.writes[1].eva_despues,null);
});

test("minor narrative save retains exact legacy answers/flags, rejects replacing or erasing them", async () => {
  const historical = {
    v: 3,
    phq9: [1, 1, 1, 1, 1, 1, 1, 1, 2],
    crisisPlan: { cssrs: [true, false, false, false, false, false] },
    registro: { riesgo: "plan" },
  };
  const existing = {
    id,
    locked_at: null,
    updated_at: encounter,
    tool_id: "psicologia.escalas.v3",
    tool_data_cifrado: `synthetic:${JSON.stringify(historical)}`,
    vertebras_json: [],
  };
  const f = fixture("2014-09-08", { existing });
  for (const toolData of [historical, null]) {
    const result = await f.upsert({
      turnoId: id,
      pacienteId: id,
      soap: { s: "Synthetic updated narrative" },
      toolData,
    });
    assert.equal(result.ok, true);
    assert.ok(!("tool_data_cifrado" in f.writes.at(-1)!));
  }
  const changedNarrative = {
    ...historical,
    registro: { riesgo: "plan", nota: "Synthetic updated assessment" },
  };
  const result = await f.upsert({
    turnoId: id,
    pacienteId: id,
    toolData: changedNarrative,
  });
  assert.equal(result.ok, true);
  assert.ok(
    policy.instrumentFieldsUnchanged(
      "psicologia",
      JSON.parse(
        String(f.writes.at(-1)!.tool_data_cifrado).replace(/^synthetic:/, ""),
      ),
      historical,
    ),
  );
  for (const toolData of [
    { v: 3, registro: { riesgo: "plan" } },
    { ...historical, phq9: Array(9).fill(0) },
  ]) {
    assert.equal(
      (await f.upsert({ turnoId: id, pacienteId: id, toolData })).ok,
      false,
    );
  }
});

test("kinesiology outcomes are gated while pain observation and narrative stay available", async () => {
  const f = fixture("2014-09-08", { specialty: "kinesiologia" });
  assert.equal(
    (
      await f.upsert({
        turnoId: id,
        pacienteId: id,
        toolData: { v: 1, ndi: Array(10).fill(0) },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await f.upsert({
        turnoId: id,
        pacienteId: id,
        toolData: { v: 1, motivo: "Synthetic observation", dolorEva: 4 },
      })
    ).ok,
    true,
  );
});

const jsx = (type: unknown, props: unknown) => ({ type, props });
const react = {
  useId: () => "synthetic-id",
  useState: (v: unknown) => [v, () => {}],
  useMemo: (fn: () => unknown) => fn(),
};
const uiOverrides = {
  react,
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
  "@/components/icons": new Proxy({}, { get: () => "icon" }),
};
test("actual generic UI does not call scoring or offer inputs for blocked ages; raw answers remain visible", () => {
  const ui = load(
    "lib/instrumentos/components/PlanillaRenderer.tsx",
    uiOverrides,
  );
  let scores = 0;
  const def = {
    id: "test.v1",
    nombre: "Synthetic scale",
    items: [{ id: "q", texto: "Q" }],
    opciones: [{ valor: 0, label: "Zero" }],
    score: () => {
      scores++;
      return null;
    },
  };
  for (const fechaNacimiento of dObs) {
    const rendered = ui.PlanillaRenderer({
      def,
      respuestas: [1],
      onChange: () => assert.fail(),
      population: { fechaNacimiento, fechaAtencion: encounter },
    });
    const tree = JSON.stringify(rendered);
    assert.ok(tree.includes("sin interpretación nueva"));
    assert.ok(tree.includes("[1]"));
    assert.ok(!tree.includes('"type":"input"'));
    assert.equal(scores, 0);
  }
  const adult = ui.PlanillaRenderer({
    def,
    respuestas: [1],
    onChange: () => {},
    population: { fechaNacimiento: "1990-01-01", fechaAtencion: encounter },
  });
  if (typeof adult.type === "function") adult.type(adult.props);
  assert.equal(scores, 1);
});

test("unused cardiology wrappers reject pediatric ages without returning a low-risk label", () => {
  for (const edad of [0, 12, 14, 16, 17]) {
    assert.equal(scoreCHA2DS2VASc({ edad }), null);
    assert.equal(scoreHASBLED({ edad }), null);
    assert.equal(bandaSCORE2({ edad, riesgoPct: 2 }), null);
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- traverses the synthetic JSX tree
function nodes(value: any): any[] {
  if (value == null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props?.children)];
}
const componentNames = new Proxy({}, { get: (_, name) => String(name) });
const clinicalUiOverrides = {
  ...uiOverrides,
  "next/navigation": { useRouter: () => ({ refresh: () => {} }) },
  "@/app/(app)/pacientes/actions": {
    registrarCssrsAction: () => assert.fail("blocked UI submitted a scale"),
  },
  "@/lib/instrumentos/components": componentNames,
  "@/lib/especialidades/psicologia/dashboard": {
    OutcomesDashboard: "OutcomesDashboard",
  },
};

test("actual psychology controls block new scores, retain legacy payload on narrative edit and keep crisis documentation available", () => {
  const ui = load(
    "lib/especialidades/psicologia/tool.tsx",
    clinicalUiOverrides,
  );
  const original = {
    v: 3,
    phq9: [1, 1, 1, 1, 1, 1, 1, 1, 2],
    crisisPlan: { cssrs: [true, false, false, false, false, false] },
    registro: { riesgo: "plan" },
  };
  for (const fechaNacimiento of dObs) {
    const writes: unknown[] = [];
    const tree = ui.PsicologiaTool({
      value: original,
      onChange: (v: unknown) => writes.push(v),
      historial: [],
      fechaNacimiento,
      fechaAtencion: encounter,
    });
    const rendered = nodes(tree);
    const scales = rendered.filter((n) => n.type?.name === "EscalaBlock");
    assert.equal(scales.length, 2);
    for (const scale of scales) {
      assert.equal(scale.props.readOnly, true);
      assert.equal(scale.props.score, null);
      scale.props.onSet(0, 0);
      scale.props.onQuitar();
    }
    assert.equal(writes.length, 0);
    const clinical = rendered.find(
      (n) => n.type === "select" && n.props.value === "plan",
    );
    assert.ok(clinical);
    assert.ok(!clinical.props.disabled);
    clinical.props.onChange({ target: { value: "ideacion" } });
    assert.equal(writes.length, 1);
    assert.ok(
      policy.instrumentFieldsUnchanged("psicologia", writes[0], original),
    );
    const crisis = rendered.find((n) => n.type?.name === "CrisisWorkflow");
    assert.ok(crisis);
    const crisisNodes = nodes(crisis.type(crisis.props));
    assert.ok(
      crisisNodes.some((n) => n.type === "textarea" && !n.props.disabled),
    );
    assert.ok(!crisisNodes.some((n) => n.type === "ResultadoBadge"));
  }
  const adult = nodes(
    ui.PsicologiaTool({
      value: original,
      onChange: () => {},
      historial: [],
      fechaNacimiento: "1990-01-01",
      fechaAtencion: encounter,
    }),
  );
  assert.ok(
    adult.some(
      (n) =>
        n.type?.name === "EscalaBlock" &&
        !n.props.readOnly &&
        n.props.score !== null,
    ),
  );
  const noRisk = nodes(
    ui.PsicologiaTool({
      value: null,
      onChange: () => {},
      historial: [],
      fechaNacimiento: "2014-01-01",
      fechaAtencion: encounter,
    }),
  );
  const care = noRisk.find((n) => n.type?.name === "CrisisWorkflow");
  assert.ok(care);
  assert.equal(care.type(care.props).props.style, undefined);
});

test("actual outcomes dashboard never recalculates a pediatric encounter using current adult age", () => {
  const dashboard = load("lib/especialidades/psicologia/dashboard.tsx", {
    ...clinicalUiOverrides,
    react: { ...react, useEffect: () => {} },
  });
  const original = { v: 3, phq9: Array(9).fill(2) };
  for (const [fechaNacimiento, fecha, count] of [
    ["2000-01-01", "2014-01-01", 0],
    ["2000-01-01", "2026-09-08", 1],
    [null, "2026-09-08", 0],
  ] as const) {
    const tree = dashboard.OutcomesDashboard({
      fechaNacimiento,
      historial: [{ fecha, toolData: original }],
    });
    const series = nodes(tree).find((n) => n.type === "SerieEvolucion");
    assert.ok(series);
    assert.equal(series.props.serie.length, count);
  }
});

test("dashboard network failure ends loading, sanitizes errors, supports retry and respects unmount", async () => {
  for (const unmount of [false, true]) {
    const updates: Array<[number, unknown]> = [];
    let cursor = 0;
    let effect: (() => undefined | (() => void)) | undefined;
    const dashboard = load("lib/especialidades/psicologia/dashboard.tsx", {
      ...clinicalUiOverrides,
      react: {
        useState: (initial: unknown) => {
          const index = cursor++;
          return [initial, (v: unknown) => updates.push([index, v])];
        },
        useEffect: (fn: () => undefined | (() => void)) => {
          effect = fn;
        },
      },
      "@/app/(app)/pacientes/actions": {
        listOutcomeSeriesAction: () =>
          Promise.reject(new Error("SECRET_PATIENT_NETWORK_ERROR")),
      },
    });
    dashboard.OutcomesDashboard({
      pacienteId: id,
      historial: [],
      fechaNacimiento: null,
    });
    const cleanup = effect?.();
    const count = updates.length;
    if (unmount) cleanup?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      !JSON.stringify(updates).includes("SECRET_PATIENT_NETWORK_ERROR"),
    );
    if (unmount) assert.equal(updates.length, count);
    else {
      assert.ok(updates.some(([i, v]) => i === 1 && v === false));
      assert.ok(
        updates.some(
          ([i, v]) =>
            i === 2 &&
            typeof v === "string" &&
            v.includes("volver a intentarlo"),
        ),
      );
    }
  }
  let index = 0;
  const retry: unknown[] = [];
  const dashboard = load("lib/especialidades/psicologia/dashboard.tsx", {
    ...clinicalUiOverrides,
    react: {
      useEffect: () => {},
      useState: (v: unknown) => {
        const i = index++;
        return [
          i === 2 ? "No pudimos cargar las escalas." : v,
          (next: unknown) => {
            if (i === 3) retry.push(next);
          },
        ];
      },
    },
  });
  const tree = dashboard.OutcomesDashboard({ pacienteId: id, historial: [] });
  const button = nodes(tree).find(
    (n) => n.type === "button" && n.props.children === "Reintentar",
  );
  assert.ok(button);
  button.props.onClick();
  assert.equal(retry.length, 1);
});
