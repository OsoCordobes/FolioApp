import type { ComponentProps } from "react";

import type { Calendario } from "@/components/calendario/calendario";
import type { Configuracion } from "@/components/configuracion/configuracion";
import type { OnboardingApp } from "@/components/onboarding/onboarding-app";
import type { PacienteDetalle } from "@/components/paciente/paciente-detalle";
import type { FinanzasData } from "@/lib/db/finanzas";
import type { PacienteDirRow } from "@/lib/db/pacientes-dir";
import type { PortalPerfilView } from "@/lib/db/portal-perfil";
import type { PortalResumenView } from "@/lib/db/portal-resumen";
import type { PortalTurnoView } from "@/lib/db/portal-turnos";
import { ESPECIALIDADES_META, type EspecialidadSlug } from "@/lib/especialidades/meta";
import type { PacientesById, Turno, TurnoSemana } from "@/lib/types";

// Entirely invented records. IDs intentionally cannot identify production rows.
export const PREVIEW_DATE = "2026-09-10";
export const PREVIEW_NOW = "2026-09-10T10:15:00-03:00";
export const PREVIEW_ORG = "folio-test-experience-org";
export const organization = {
  nombre: "Consultorio del Parque",
  rubro: "Kinesiología",
  slug: "folio-test-experience",
  isInternalAccount: false,
};

const names = ["Elena Torres", "Tomás Acosta", "Lucía Pereira", "Mateo Vidal", "Clara Gómez", "Julián Ríos"];
export const patientRows: PacienteDirRow[] = names.map((nombre, index) => ({
  id: `folio-test-patient-${index + 1}`,
  nombre,
  tel: "",
  email: `paciente${index + 1}@example.test`,
  tipo: index === 2 ? "nuevo" : "recurrente",
  sesiones: index === 2 ? 0 : [8, 3, 0, 12, 5, 6][index],
  ultima: index === 2 ? null : "2026-09-03",
  proximo: PREVIEW_DATE,
  tags: index === 3 ? ["ALTA"] : [],
  estado: index === 3 ? "alta" : "activo",
  cobertura: index % 2 === 0 ? "Particular" : "Cobertura de ejemplo",
  coberturaPlan: null,
}));

export const patients: PacientesById = Object.fromEntries(patientRows.map((p, index) => [p.id, {
  nombre: p.nombre,
  tipo: p.tipo,
  sesiones: p.sesiones,
  edad: 28 + index * 4,
  genero: index % 2 === 0 ? "F" : "M",
  motivo: "Seguimiento de ejemplo",
  tags: p.tags,
  notasImportantes: "Datos ficticios para revisar la interfaz.",
  telefono: "",
}]));

export const appointments: Turno[] = patientRows.map((p, index) => ({
  id: `folio-test-appointment-${index + 1}`,
  pacienteId: p.id,
  hora: ["08:30", "09:15", "10:30", "11:15", "14:00", "15:00"][index],
  servicio: index === 2 ? "Consulta inicial" : "Sesión de seguimiento",
  precio: index === 2 ? 35000 : 25000,
  estado: (["cerrado", "atendiendo", "en_sala", "confirmado", "agendado", "confirmado"] as const)[index],
  duracionMin: 45,
  duracionRealMin: index === 0 ? 42 : null,
  atendiendoDesde: index === 1 ? "2026-09-10T09:55:00-03:00" : null,
  postVisita: { guardada: index === 0 },
  origen: index % 2 === 0 ? "web" : "manual",
  confirmadoVia: index === 3 ? "paciente" : null,
  cobro: index === 0 ? { estado: "pagado", ts: "2026-09-10T12:10:00Z", montoCents: 2500000 } : undefined,
}));

export const weekDates = ["2026-09-07", "2026-09-08", "2026-09-09", PREVIEW_DATE, "2026-09-11", "2026-09-12", "2026-09-13"];
export const weekAppointments: TurnoSemana[] = appointments.map((t, index) => ({
  id: t.id,
  fecha: index < 3 ? PREVIEW_DATE : weekDates[index - 3],
  hora: t.hora,
  dur: t.duracionMin ?? 45,
  pacienteId: t.pacienteId,
  servicio: t.servicio,
  estado: t.estado,
  origen: t.origen,
}));

export const monthGrid = Array.from({ length: 35 }, (_, index) => {
  const dateIso = new Date(Date.UTC(2026, 7, 31 + index)).toISOString().slice(0, 10);
  return { dateIso, inCurrentMonth: dateIso.startsWith("2026-09"), isToday: dateIso === PREVIEW_DATE };
});

export const calendar: ComponentProps<typeof Calendario> = {
  turnos: weekAppointments,
  bloqueos: [{ fecha: PREVIEW_DATE, hora: "13:00", dur: 60, titulo: "Pausa", origen: "manual" }],
  pedidos: [], pacientes: patients, weekDates,
  diasCerrados: [false, false, false, false, false, true, true],
  capacidadDiaMin: [480, 480, 480, 480, 360, 0, 0],
  rangoDisponibilidadMin: { desdeMin: 480, hastaMin: 1020 },
  weekRangeLabel: "7 — 13 de septiembre 2026", hoyIso: PREVIEW_DATE, nowHHMM: "10:15",
  weekStartIso: weekDates[0], prevWeekIso: "2026-08-31", nextWeekIso: "2026-09-14",
  hoyWeekStartIso: weekDates[0], mesGrid: monthGrid, mesTurnos: weekAppointments,
  mesPacientes: patients, mesLabel: "Septiembre 2026", mesHoyIso: PREVIEW_DATE,
  monthIso: "2026-09-01", prevMonthIso: "2026-08-01", nextMonthIso: "2026-10-01", hoyMonthIso: "2026-09-01",
};

export const finance: FinanzasData = {
  mesLabel: "septiembre 2026", mesNumero: 9, anio: 2026, diaActual: 10, diasDelMes: 30,
  hoyFecha: PREVIEW_DATE, totalIngresos: 875000, totalSesiones: 35, ticketPromedio: 25000,
  proyeccionFinDeMes: 2625000, deltaIngresosVsMesPasadoPct: 12,
  ingresosPorDia: Array.from({ length: 10 }, (_, i) => ({
    fecha: `2026-09-${String(i + 1).padStart(2, "0")}`,
    label: String(i + 1), monto: [100000, 125000, 75000, 125000, 0, 0, 100000, 75000, 150000, 125000][i],
  })),
  ingresosPorMes: [], esRangoLargo: false, porCobrar: 50000, porCobrarCount: 2,
  serviciosBreakdown: [{ id: "folio-test-service-1", nombre: "Seguimiento", count: 35, monto: 875000, color: "var(--accent)" }],
  profesionalesBreakdown: null,
  transacciones: patientRows.map((p, index) => ({
    id: `folio-test-payment-${index}`, fecha: `2026-09-10T${String(9 + index).padStart(2, "0")}:00:00-03:00`,
    paciente: p.nombre, servicio: "Seguimiento", monto: 25000,
    metodo: index % 2 === 0 ? "transferencia" : "efectivo", estado: index > 3 ? "pendiente" : "cobrado",
  })),
  cobradosNoListados: 31, datosParciales: false,
};

export const chart: ComponentProps<typeof PacienteDetalle> = {
  paciente: {
    id: patientRows[0].id, nombre: names[0], nombrePila: "Elena", apellido: "Torres",
    tipo: "recurrente", sesiones: 8, edad: 28, genero: "F", motivo: "Seguimiento de ejemplo",
    tags: [], notasImportantes: "Ficha enteramente ficticia.", telefono: "", tel: "",
    email: "paciente1@example.test", ocupacion: "Docente", recomendadoPor: "",
    coberturaNombre: "Particular", coberturaPlan: null, coberturaNroAfiliado: null, coberturaLeida: true,
  },
  plan: {
    total: 10, completadas: 8, frecuencia: "Semanal", inicio: "2026-07-16",
    proximoControl: "2026-09-17", precio: 25000, diagnostico: "Plan de seguimiento de ejemplo",
    vertebrasEstado: {}, ultimoAjuste: {},
    soap: { subjetivo: "Evolución favorable en este ejemplo ficticio.", objetivo: "Evaluación de demostración.", analisis: "Continuar seguimiento.", plan: "Próxima revisión en una semana." },
    sesiones: [{ fecha: "2026-09-03", servicio: "Seguimiento", dur: 45, cambio: "Revisión de ejemplo", vertebras: [], sesionId: null, soap: null }],
    toolHistorial: [], turnoActivo: null, historialTotal: 8, radiografias: [], estudiosAdjuntos: [],
    planEditable: { sesionesObjetivo: 10, frecuencia: "Semanal", diagnostico: "Plan de ejemplo", proximoControl: "2026-09-17", notas: null },
  },
  cumple: "18 may", especialidad: "kinesiologia", intakeAvanzado: null,
  organizacionNombre: organization.nombre, notas: [],
};

const specialtyToolExamples: Record<EspecialidadSlug, unknown> = {
  cardiologia: { v: 3, panel: { taSistolica: 120, taDiastolica: 80, fc: 72, peso: 68, talla: 168, satO2: 98 } },
  psicologia: { v: 3 },
  quiropraxia: { v: 2, vista: "posterior", vertebras: [{ id: "C4", tecnicaAjuste: "diversificada" }, { id: "T7", listado: "PRS" }] },
  kinesiologia: { v: 1, motivo: "Seguimiento funcional ficticio", dolorEva: 3 },
  nutricion: { v: 1, peso: 68, talla: 168, planAlimentario: "Plan de demostración sin indicación clínica real.", observaciones: "Registro ficticio para evaluar la interfaz." },
};

/** The real registry validates each synthetic payload before mounting its Tool. */
export function specialtyChart(especialidad: EspecialidadSlug, editable: boolean, patientId?: string): ComponentProps<typeof PacienteDetalle> {
  const metadata = ESPECIALIDADES_META[especialidad];
  const toolData = metadata.schema.parse(specialtyToolExamples[especialidad]);
  const selectedPatient = patientRows.find((patient) => patient.id === patientId) ?? patientRows[0];
  const [nombrePila, ...surname] = selectedPatient.nombre.split(" ");
  return {
    ...chart,
    paciente: { ...chart.paciente, id: selectedPatient.id, nombre: selectedPatient.nombre, nombrePila, apellido: surname.join(" "), email: selectedPatient.email },
    especialidad,
    plan: {
      ...chart.plan,
      toolHistorial: [{ fecha: "2026-09-03", toolData, toolId: metadata.toolId }],
      turnoActivo: editable ? {
        id: `folio-test-edit-${especialidad}-${selectedPatient.id}`, estado: "ATENDIENDO", modo: "en_curso", inicio: PREVIEW_NOW,
        especialidad, atendiendoDesde: null, toolDraft: toolData, soapDraft: chart.plan.soap,
        soapPrevio: null, sesionUpdatedAt: null, tieneSesionGuardada: false,
      } : null,
    },
  };
}

export const configuration: ComponentProps<typeof Configuracion> = {
  orgSlug: organization.slug,
  initialConsultorio: {
    nombre: organization.nombre, profesional: "Valentina Costa", matricula: "Ejemplo 1234",
    email: "profesional@example.test", tel: "", direccion: "Dirección de ejemplo", ciudad: "Córdoba",
    provincia: "Córdoba", instagram: "", timezone: "America/Argentina/Cordoba", especialidad: "kinesiologia",
  },
  initialServicios: [{ id: "folio-test-service-1", nombre: "Seguimiento", dur: 45, precio: 25000, paraNuevos: false, activo: true }],
  initialDias: {
    lun: { on: true, franjas: [["08:30", "17:00"]] }, mar: { on: true, franjas: [["08:30", "17:00"]] },
    mie: { on: true, franjas: [["08:30", "17:00"]] }, jue: { on: true, franjas: [["08:30", "17:00"]] },
    vie: { on: true, franjas: [["08:30", "15:00"]] }, sab: { on: false, franjas: [] }, dom: { on: false, franjas: [] },
  },
  initialAutoConfirmar: true, initialSlotMargenMin: 15,
  googleCalendar: { conectado: false, expiraTs: null, ultimoUsoTs: null, ultimoErrorTs: null, muerta: false },
  gcalError: null, orgTipo: "INDEPENDIENTE", canEdit: false, membersActivos: 1,
  montoActualCents: 5000000, montoClinicaCents: 10000000, canManageTeam: false, isOwner: false,
  equipoMembers: [], equipoInvitations: [], equipoSelf: null, esColegiado: true,
  initialPerfilPublico: null, initialListarEnDirectorio: false, suscripcionEstado: null,
  whatsappConfigured: false, showVinculaciones: false, logoUrl: null, showImportarPacientes: false,
};

export const onboarding: ComponentProps<typeof OnboardingApp> = {
  initialStep: 2, initialSlug: organization.slug, planPriceCents: 5000000,
  initialData: {
    email: "profesional@example.test", nombre: "Valentina", apellido: "Costa", matricula: "1234",
    consultorioNombre: organization.nombre, rubro: "kinesiologia", especialidad: "kinesiologia",
    ciudad: "Córdoba", provincia: "Córdoba", direccion: "Dirección de ejemplo",
  },
};

export const portalAppointments: PortalTurnoView[] = [{
  id: "folio-test-portal-appointment", organizationId: PREVIEW_ORG, organizacionNombre: organization.nombre,
  organizacionSlug: organization.slug, inicio: "2026-09-17T13:30:00Z", duracionMin: 45,
  estado: "CONFIRMADO", modalidad: "presencial", servicioId: null, profesionalId: null,
  cutoffHoras: 24, cancelable: false,
}];
export const portalSummary: PortalResumenView = {
  turnosPasados: [{ id: "folio-test-portal-past", organizationId: PREVIEW_ORG, organizacionNombre: organization.nombre, inicio: "2026-09-03T13:30:00Z", duracionMin: 45, estado: "CERRADO", modalidad: "presencial" }],
  consentimientos: [{ id: "folio-test-consent", organizationId: PREVIEW_ORG, organizacionNombre: organization.nombre, tipo: "TRATAMIENTO", tipoLabel: "Consentimiento de atención", firmadoEn: "2026-07-16T12:00:00Z", revocadoEn: null, plantillaTitulo: "Atención en consultorio", plantillaVersion: 1 }],
};
export const portalProfiles: PortalPerfilView[] = [{
  identidadId: "folio-test-identity", pacienteId: patientRows[0].id, organizationId: PREVIEW_ORG,
  organizacionNombre: organization.nombre, nombre: "Elena", apellido: "Torres", documento: null,
  email: "paciente1@example.test", telefono: null, domicilioCalle: null, domicilioNumero: null,
  domicilioCiudad: "Córdoba", domicilioProvincia: "Córdoba", domicilioCp: null,
}];
