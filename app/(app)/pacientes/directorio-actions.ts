"use server";
import { getPacientesDirectorio } from "@/lib/db/pacientes-dir";
export async function loadDirectoryPage(input: unknown) {
  return getPacientesDirectorio(input);
}
