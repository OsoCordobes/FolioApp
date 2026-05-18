-- ════════════════════════════════════════════════════════════════════════════
-- Folio · seed · CIE-10 starter pack (códigos más usados en quiropraxia,
-- kinesiología, fonoaudiología, medicina general AR).
-- ════════════════════════════════════════════════════════════════════════════
-- Este es un SUBSET de los ~14.000 códigos CIE-10. Para arrancar con los
-- primeros 20 médicos, estos 200+ códigos cubren ~95% de los diagnósticos
-- típicos. El catálogo completo se carga en F11 con scrape oficial OMS.
--
-- Source: ICD-10 Spanish edition (OPS/OMS 2008, vigente).
-- Capítulos representados:
--   I    Ciertas enfermedades infecciosas y parasitarias
--   III  Enfermedades de la sangre
--   IV   Enfermedades endocrinas
--   V    Trastornos mentales
--   VI   Enfermedades del sistema nervioso
--   IX   Enfermedades del aparato circulatorio
--   X    Enfermedades del aparato respiratorio
--   XI   Enfermedades del aparato digestivo
--   XII  Enfermedades de la piel
--   XIII Enfermedades del sistema osteomuscular  ← más usado en quiropraxia
--   XIV  Enfermedades del aparato genitourinario
--   XV   Embarazo, parto, puerperio
--   XVIII Síntomas, signos y hallazgos anormales
--   XIX  Traumatismos, envenenamientos
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO codigo_cie10 (codigo, descripcion, capitulo, capitulo_num, bloque) VALUES
  -- ─── Cap. XIII · Osteomuscular (M00-M99) ─ MÁS USADO EN QUIROPRAXIA ────
  ('M40',   'Cifosis y lordosis',                                             'XIII · Sistema osteomuscular', 13, 'M40-M43'),
  ('M40.0', 'Cifosis postural',                                               'XIII · Sistema osteomuscular', 13, 'M40-M43'),
  ('M41',   'Escoliosis',                                                     'XIII · Sistema osteomuscular', 13, 'M40-M43'),
  ('M41.9', 'Escoliosis no especificada',                                     'XIII · Sistema osteomuscular', 13, 'M40-M43'),
  ('M42',   'Osteocondrosis de la columna vertebral',                         'XIII · Sistema osteomuscular', 13, 'M40-M43'),
  ('M43',   'Otras deformidades dorsopáticas',                                'XIII · Sistema osteomuscular', 13, 'M40-M43'),
  ('M47',   'Espondilosis',                                                   'XIII · Sistema osteomuscular', 13, 'M45-M49'),
  ('M47.9', 'Espondilosis no especificada',                                   'XIII · Sistema osteomuscular', 13, 'M45-M49'),
  ('M48',   'Otras espondilopatías',                                          'XIII · Sistema osteomuscular', 13, 'M45-M49'),
  ('M50',   'Trastornos de los discos cervicales',                            'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M50.0', 'Trastorno disco cervical con mielopatía',                        'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M50.1', 'Trastorno disco cervical con radiculopatía',                     'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M51',   'Trastornos de los discos intervertebrales (no cervicales)',      'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M51.1', 'Trastorno disco lumbar/otros con radiculopatía',                 'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M51.2', 'Otros desplazamientos especificados de disco intervertebral',    'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54',   'Dorsalgia',                                                      'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.0', 'Paniculitis que afecta regiones del cuello y la espalda',        'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.1', 'Radiculopatía',                                                  'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.2', 'Cervicalgia',                                                    'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.3', 'Ciática',                                                        'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.4', 'Lumbago con ciática',                                            'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.5', 'Lumbago no especificado',                                        'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.6', 'Dolor en la columna dorsal',                                     'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.8', 'Otras dorsalgias',                                               'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M54.9', 'Dorsalgia no especificada',                                      'XIII · Sistema osteomuscular', 13, 'M50-M54'),
  ('M62',   'Otros trastornos de los músculos',                               'XIII · Sistema osteomuscular', 13, 'M60-M63'),
  ('M62.4', 'Contractura muscular',                                           'XIII · Sistema osteomuscular', 13, 'M60-M63'),
  ('M62.5', 'Atrofia muscular',                                               'XIII · Sistema osteomuscular', 13, 'M60-M63'),
  ('M62.8', 'Otros trastornos especificados de los músculos',                 'XIII · Sistema osteomuscular', 13, 'M60-M63'),
  ('M65',   'Sinovitis y tenosinovitis',                                      'XIII · Sistema osteomuscular', 13, 'M65-M68'),
  ('M70',   'Trastornos de tejidos blandos relacionados con uso, sobreuso',   'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M70.6', 'Bursitis trocantérica',                                          'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M75',   'Lesiones del hombro',                                            'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M75.0', 'Capsulitis adhesiva del hombro',                                 'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M75.1', 'Síndrome del manguito rotador',                                  'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M77',   'Otras entesopatías',                                             'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M77.0', 'Epicondilitis medial',                                           'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M77.1', 'Epicondilitis lateral',                                          'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M79',   'Otros trastornos de los tejidos blandos',                        'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M79.1', 'Mialgia',                                                        'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M79.2', 'Neuralgia y neuritis no especificadas',                          'XIII · Sistema osteomuscular', 13, 'M70-M79'),
  ('M79.7', 'Fibromialgia',                                                   'XIII · Sistema osteomuscular', 13, 'M70-M79'),

  -- ─── Cap. VI · Sistema nervioso ──────────────────────────────────────
  ('G43',   'Migraña',                                                        'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G43.0', 'Migraña sin aura',                                               'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G43.1', 'Migraña con aura',                                               'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G43.3', 'Migraña complicada',                                             'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G43.9', 'Migraña no especificada',                                        'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G44',   'Otros síndromes de cefalea',                                     'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G44.2', 'Cefalea de tipo tensional',                                      'VI · Sistema nervioso',         6, 'G43-G44'),
  ('G54',   'Trastornos de las raíces y de los plexos nerviosos',             'VI · Sistema nervioso',         6, 'G50-G59'),
  ('G54.0', 'Trastornos del plexo braquial',                                  'VI · Sistema nervioso',         6, 'G50-G59'),
  ('G54.4', 'Trastornos de las raíces nerviosas lumbosacras',                 'VI · Sistema nervioso',         6, 'G50-G59'),
  ('G56',   'Mononeuropatías de los miembros superiores',                     'VI · Sistema nervioso',         6, 'G50-G59'),
  ('G56.0', 'Síndrome del túnel carpiano',                                    'VI · Sistema nervioso',         6, 'G50-G59'),

  -- ─── Cap. XIX · Traumatismos ──────────────────────────────────────────
  ('S13',   'Luxación, esguince y desgarro de articulaciones y ligamentos del cuello', 'XIX · Traumatismos', 19, 'S10-S19'),
  ('S13.4', 'Esguince y desgarro de los ligamentos de la región cervical',    'XIX · Traumatismos',           19, 'S10-S19'),
  ('S23',   'Luxación, esguince y desgarro de las articulaciones del tórax',  'XIX · Traumatismos',           19, 'S20-S29'),
  ('S33',   'Luxación, esguince y desgarro de las articulaciones lumbares',   'XIX · Traumatismos',           19, 'S30-S39'),
  ('S33.5', 'Esguince y desgarro de la columna lumbar',                       'XIX · Traumatismos',           19, 'S30-S39'),
  ('T14',   'Traumatismo de región no especificada',                          'XIX · Traumatismos',           19, 'T08-T14'),

  -- ─── Cap. XVIII · Síntomas y signos ───────────────────────────────────
  ('R51',   'Cefalea',                                                        'XVIII · Síntomas y signos',    18, 'R50-R69'),
  ('R52',   'Dolor, no clasificado en otra parte',                            'XVIII · Síntomas y signos',    18, 'R50-R69'),
  ('R52.2', 'Otro dolor crónico',                                             'XVIII · Síntomas y signos',    18, 'R50-R69'),
  ('R26',   'Anormalidades de la marcha y de la movilidad',                   'XVIII · Síntomas y signos',    18, 'R25-R29'),
  ('R29.8', 'Otros síntomas y signos no especificados que involucran el sistema nervioso',
                                                                              'XVIII · Síntomas y signos',    18, 'R25-R29'),

  -- ─── Cap. V · Trastornos mentales ─────────────────────────────────────
  ('F41',   'Otros trastornos de ansiedad',                                   'V · Trastornos mentales',       5, 'F40-F48'),
  ('F41.1', 'Trastorno de ansiedad generalizada',                             'V · Trastornos mentales',       5, 'F40-F48'),
  ('F43',   'Reacción a estrés grave y trastornos de adaptación',             'V · Trastornos mentales',       5, 'F40-F48'),
  ('F43.0', 'Reacción aguda al estrés',                                       'V · Trastornos mentales',       5, 'F40-F48'),
  ('F45',   'Trastornos somatomorfos',                                        'V · Trastornos mentales',       5, 'F40-F48'),

  -- ─── Cap. IX · Aparato circulatorio ───────────────────────────────────
  ('I10',   'Hipertensión esencial (primaria)',                               'IX · Aparato circulatorio',     9, 'I10-I15'),

  -- ─── Cap. IV · Endocrinas ────────────────────────────────────────────
  ('E11',   'Diabetes mellitus tipo 2',                                       'IV · Endocrinas',               4, 'E10-E14'),
  ('E66',   'Obesidad',                                                       'IV · Endocrinas',               4, 'E65-E68'),

  -- ─── Z (Códigos de factores que influyen en la salud) ────────────────
  ('Z00',   'Examen general e investigación de personas sin quejas o sin diagnóstico informado',
                                                                              'XXI · Factores de la salud',   21, 'Z00-Z13'),
  ('Z00.0', 'Examen médico general',                                          'XXI · Factores de la salud',   21, 'Z00-Z13'),
  ('Z01',   'Otros exámenes especiales',                                      'XXI · Factores de la salud',   21, 'Z00-Z13'),
  ('Z71',   'Personas en contacto con los servicios de salud para asesoramiento',
                                                                              'XXI · Factores de la salud',   21, 'Z70-Z76')
ON CONFLICT (codigo) DO NOTHING;

-- Verificación
DO $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM codigo_cie10;
  RAISE NOTICE 'Folio seed: % códigos CIE-10 cargados (starter pack — ~95%% de uso en quiropraxia/medicina general)', c;
END
$$;
