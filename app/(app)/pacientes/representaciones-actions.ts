"use server";
import { createRepresentacion,listRepresentaciones,reviewRepresentacion } from "@/lib/db/representaciones";
export async function listRepresentacionesAction(pacienteId:string){return listRepresentaciones(pacienteId);}
export async function createRepresentacionAction(input:unknown){return createRepresentacion(input);}
export async function reviewRepresentacionAction(input:Parameters<typeof reviewRepresentacion>[0]){return reviewRepresentacion(input);}
