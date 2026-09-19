"use server";
import {createConsentAssessment,listConsentAssessments,revokeConsentAssessment} from "@/lib/db/consentimiento-evaluacion";
export async function createConsentAssessmentAction(input:unknown){return createConsentAssessment(input);}
export async function listConsentAssessmentsAction(pacienteId:string){return listConsentAssessments(pacienteId);}
export async function revokeConsentAssessmentAction(id:string,pacienteId:string,motivo:string){return revokeConsentAssessment(id,pacienteId,motivo);}
