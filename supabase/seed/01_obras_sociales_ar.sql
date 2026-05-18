-- ════════════════════════════════════════════════════════════════════════════
-- Folio · seed · Obras sociales y prepagas argentinas
-- ════════════════════════════════════════════════════════════════════════════
-- Subset de las obras sociales más usadas en AR. Los códigos RNOS son los
-- oficiales de la Superintendencia de Servicios de Salud (cuando aplica).
-- Las prepagas no tienen RNOS (no son obras sociales).
--
-- Source: https://www.sssalud.gob.ar/, https://www.argentina.gob.ar/sssalud
-- Snapshot: 2026. Para actualizar: SCRAPE el padrón oficial vía F11.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO obra_social (codigo_rnos, nombre, nombre_corto, tipo) VALUES
  -- Particular (cash) — siempre primera por default
  (NULL,    'Particular (sin cobertura)',                       'Particular',     'PARTICULAR'),

  -- PAMI (jubilados y pensionados)
  (NULL,    'PAMI · Instituto Nacional de Servicios Sociales',  'PAMI',           'PAMI'),

  -- Prepagas (las top, sin codigo RNOS)
  (NULL,    'OSDE Binario',                                     'OSDE',           'PREPAGA'),
  (NULL,    'Swiss Medical Group',                              'Swiss Medical',  'PREPAGA'),
  (NULL,    'Galeno',                                           'Galeno',         'PREPAGA'),
  (NULL,    'Medicus',                                          'Medicus',        'PREPAGA'),
  (NULL,    'Omint',                                            'Omint',          'PREPAGA'),
  (NULL,    'Hospital Italiano',                                'Hospital Italiano','PREPAGA'),
  (NULL,    'Hospital Británico',                               'Hospital Británico','PREPAGA'),
  (NULL,    'Sancor Salud',                                     'Sancor Salud',   'PREPAGA'),

  -- Obras sociales nacionales
  ('1-0050-2', 'IOMA · Instituto de Obra Médico Asistencial (Provincia BA)', 'IOMA',         'OBRA_SOCIAL'),
  ('1-0660-3', 'APROSS · Administración Provincial Seguro Salud Córdoba',    'APROSS',       'OBRA_SOCIAL'),
  ('1-1980-1', 'IAPOS · Salud Pública Santa Fe',                              'IAPOS',        'OBRA_SOCIAL'),
  ('1-0070-3', 'OSDE',                                                       'OSDE OS',      'OBRA_SOCIAL'),
  ('1-2270-2', 'OSPEDYC',                                                    'OSPEDYC',      'OBRA_SOCIAL'),

  -- Sindicales (top 10)
  ('1-0610-7', 'Unión Personal Civil Nación',                                'UPCN',         'SINDICAL'),
  ('1-1500-2', 'OSECAC · Empleados de Comercio',                             'OSECAC',       'SINDICAL'),
  ('1-1830-3', 'Construir · UOCRA',                                          'UOCRA',        'SINDICAL'),
  ('1-0300-1', 'OSPACA · Personal de Casas Particulares',                    'OSPACA',       'SINDICAL'),
  ('1-2920-1', 'OSCHOCA · Choferes de Camiones',                             'OSCHOCA',      'SINDICAL'),
  ('1-2780-2', 'OSPSA · Sanidad',                                            'OSPSA',        'SINDICAL'),
  ('1-2440-3', 'OSPRERA · Reparaciones Eléctricas',                          'OSPRERA',      'SINDICAL'),
  ('1-0670-9', 'OSPLAD · Personal Logístico Aduana',                         'OSPLAD',       'SINDICAL'),
  ('1-3500-7', 'OSPATCA · Trabajadores Carbón',                              'OSPATCA',      'SINDICAL'),
  ('1-1740-1', 'OSPRERA · Personal Rural',                                   'OSPRERA RURAL','SINDICAL')
ON CONFLICT DO NOTHING;

-- Verificación rápida
DO $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM obra_social;
  RAISE NOTICE 'Folio seed: % obras sociales cargadas', c;
END
$$;
