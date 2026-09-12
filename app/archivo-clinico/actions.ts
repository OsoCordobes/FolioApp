"use server";
import { readClinicalArchive } from "@/lib/patient/clinical-archive";

export async function searchClinicalArchive(input: unknown) {
  return readClinicalArchive(input);
}
