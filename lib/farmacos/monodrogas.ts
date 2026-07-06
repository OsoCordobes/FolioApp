/**
 * Folio · referencia de fármacos · catálogo curado de monodrogas (puro, sin DB).
 *
 * Subconjunto pragmático de monodrogas (DCI / principios activos) frecuentes en
 * la práctica ambulatoria en Argentina, para autocompletar la monodroga en el
 * form de receta (R2). NO es un vademécum completo — marcas comerciales,
 * presentaciones, dosis y clasificación ATC completa quedan diferidas (ver el
 * header de types.ts). Ampliar este catálogo es 100% aditivo.
 *
 * Cada `id` es un slug estable y único (normalizarNombre del `nombre`); nunca se
 * edita un `id` publicado (un consumidor podría haberlo persistido como
 * referencia). Este módulo no importa React ni toca la DB.
 */

import type { Monodroga } from "./types";

/**
 * Catálogo curado. Ordenado por grupo terapéutico y luego alfabético dentro del
 * grupo (el orden acá es el orden por defecto del selector de la UI).
 */
export const MONODROGAS: readonly Monodroga[] = [
  // ─── Analgésicos y AINE ────────────────────────────────────────────────────
  { id: "paracetamol", nombre: "Paracetamol", grupo: "analgesico_aine", sinonimos: ["acetaminofeno"] },
  { id: "ibuprofeno", nombre: "Ibuprofeno", grupo: "analgesico_aine" },
  { id: "diclofenac", nombre: "Diclofenac", grupo: "analgesico_aine", sinonimos: ["diclofenaco"] },
  { id: "naproxeno", nombre: "Naproxeno", grupo: "analgesico_aine" },
  { id: "ketorolac", nombre: "Ketorolac", grupo: "analgesico_aine" },
  { id: "meloxicam", nombre: "Meloxicam", grupo: "analgesico_aine" },
  { id: "tramadol", nombre: "Tramadol", grupo: "analgesico_aine" },

  // ─── Antibióticos ──────────────────────────────────────────────────────────
  { id: "amoxicilina", nombre: "Amoxicilina", grupo: "antibiotico" },
  {
    id: "amoxicilina-clavulanico",
    nombre: "Amoxicilina + ácido clavulánico",
    grupo: "antibiotico",
    sinonimos: ["amoxicilina clavulanico", "amoxi clavulanico"],
  },
  { id: "azitromicina", nombre: "Azitromicina", grupo: "antibiotico" },
  { id: "cefalexina", nombre: "Cefalexina", grupo: "antibiotico" },
  { id: "ciprofloxacina", nombre: "Ciprofloxacina", grupo: "antibiotico", sinonimos: ["ciprofloxacino"] },
  { id: "claritromicina", nombre: "Claritromicina", grupo: "antibiotico" },
  { id: "trimetoprima-sulfametoxazol", nombre: "Trimetoprima + sulfametoxazol", grupo: "antibiotico", sinonimos: ["tms", "cotrimoxazol"] },

  // ─── Cardiovascular ────────────────────────────────────────────────────────
  { id: "enalapril", nombre: "Enalapril", grupo: "cardiovascular" },
  { id: "losartan", nombre: "Losartán", grupo: "cardiovascular" },
  { id: "amlodipina", nombre: "Amlodipina", grupo: "cardiovascular", sinonimos: ["amlodipino"] },
  { id: "atenolol", nombre: "Atenolol", grupo: "cardiovascular" },
  { id: "bisoprolol", nombre: "Bisoprolol", grupo: "cardiovascular" },
  { id: "hidroclorotiazida", nombre: "Hidroclorotiazida", grupo: "cardiovascular" },
  { id: "furosemida", nombre: "Furosemida", grupo: "cardiovascular" },
  { id: "atorvastatina", nombre: "Atorvastatina", grupo: "cardiovascular" },
  { id: "rosuvastatina", nombre: "Rosuvastatina", grupo: "cardiovascular" },
  { id: "acido-acetilsalicilico", nombre: "Ácido acetilsalicílico", grupo: "cardiovascular", sinonimos: ["aspirina", "aas"] },

  // ─── Gastrointestinal ──────────────────────────────────────────────────────
  { id: "omeprazol", nombre: "Omeprazol", grupo: "gastrointestinal" },
  { id: "pantoprazol", nombre: "Pantoprazol", grupo: "gastrointestinal" },
  { id: "ranitidina", nombre: "Ranitidina", grupo: "gastrointestinal" },
  { id: "metoclopramida", nombre: "Metoclopramida", grupo: "gastrointestinal" },
  { id: "hioscina", nombre: "Hioscina", grupo: "gastrointestinal", sinonimos: ["butilhioscina", "escopolamina"] },

  // ─── Respiratorio ──────────────────────────────────────────────────────────
  { id: "salbutamol", nombre: "Salbutamol", grupo: "respiratorio" },
  { id: "budesonide", nombre: "Budesonide", grupo: "respiratorio", sinonimos: ["budesonida"] },
  { id: "loratadina", nombre: "Loratadina", grupo: "respiratorio" },
  { id: "cetirizina", nombre: "Cetirizina", grupo: "respiratorio" },

  // ─── Salud mental ──────────────────────────────────────────────────────────
  { id: "sertralina", nombre: "Sertralina", grupo: "salud_mental" },
  { id: "escitalopram", nombre: "Escitalopram", grupo: "salud_mental" },
  { id: "fluoxetina", nombre: "Fluoxetina", grupo: "salud_mental" },

  // ─── Endocrino / metabólico ────────────────────────────────────────────────
  { id: "metformina", nombre: "Metformina", grupo: "endocrino_metabolico" },
  { id: "levotiroxina", nombre: "Levotiroxina", grupo: "endocrino_metabolico", sinonimos: ["t4"] },
] as const;

/** Índice por `id` para lookup O(1). */
const POR_ID: ReadonlyMap<string, Monodroga> = new Map(MONODROGAS.map((m) => [m.id, m]));

/** Devuelve la monodroga por `id`, o `undefined` si no está en el catálogo. */
export function getMonodroga(id: string): Monodroga | undefined {
  return POR_ID.get(id);
}

/** Todos los ids del catálogo (para tests de integridad y validación). */
export function monodrogaIds(): readonly string[] {
  return MONODROGAS.map((m) => m.id);
}
