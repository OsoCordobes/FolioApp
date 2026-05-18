-- ============================================================================
-- Seed · analytics.geo_regions (Argentina)
-- ============================================================================
-- Mapeo de ciudades argentinas a niveles geográficos para cascada de cohort.
-- Cobertura: capitales provinciales + ciudades >150k habitantes + GBA + grandes
-- conurbanos. ~60 filas. Si Folio crece a localidades más chicas, agregar acá.
--
-- gran_area: 'AMBA' | 'Gran Córdoba' | 'Gran Rosario' | 'Gran Mendoza' | NULL
-- region_nacional: 'AMBA' | 'Pampeana' | 'Centro' | 'Cuyo' | 'NOA' | 'NEA' | 'Patagonia'

INSERT INTO analytics.geo_regions (ciudad, provincia, gran_area, region_nacional) VALUES
  -- AMBA
  ('CABA',                    'Ciudad Autónoma de Buenos Aires', 'AMBA', 'AMBA'),
  ('Buenos Aires',            'Ciudad Autónoma de Buenos Aires', 'AMBA', 'AMBA'),
  ('La Plata',                'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Avellaneda',              'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Lanús',                   'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Lomas de Zamora',         'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Quilmes',                 'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Tigre',                   'Buenos Aires',                    'AMBA', 'AMBA'),
  ('San Isidro',              'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Vicente López',           'Buenos Aires',                    'AMBA', 'AMBA'),
  ('San Martín',              'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Morón',                   'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Ituzaingó',               'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Tres de Febrero',         'Buenos Aires',                    'AMBA', 'AMBA'),
  ('La Matanza',              'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Pilar',                   'Buenos Aires',                    'AMBA', 'AMBA'),
  ('Escobar',                 'Buenos Aires',                    'AMBA', 'AMBA'),

  -- Buenos Aires (Pampeana, fuera de AMBA)
  ('Mar del Plata',           'Buenos Aires',                    NULL,   'Pampeana'),
  ('Bahía Blanca',            'Buenos Aires',                    NULL,   'Pampeana'),
  ('Tandil',                  'Buenos Aires',                    NULL,   'Pampeana'),
  ('Olavarría',               'Buenos Aires',                    NULL,   'Pampeana'),
  ('Pergamino',               'Buenos Aires',                    NULL,   'Pampeana'),
  ('Junín',                   'Buenos Aires',                    NULL,   'Pampeana'),
  ('Necochea',                'Buenos Aires',                    NULL,   'Pampeana'),

  -- Córdoba (Centro)
  ('Córdoba',                 'Córdoba',                         'Gran Córdoba', 'Centro'),
  ('Río Cuarto',              'Córdoba',                         NULL,           'Centro'),
  ('Villa María',             'Córdoba',                         NULL,           'Centro'),
  ('San Francisco',           'Córdoba',                         NULL,           'Centro'),
  ('Villa Carlos Paz',        'Córdoba',                         'Gran Córdoba', 'Centro'),
  ('Alta Gracia',             'Córdoba',                         'Gran Córdoba', 'Centro'),

  -- Santa Fe (Centro)
  ('Rosario',                 'Santa Fe',                        'Gran Rosario', 'Centro'),
  ('Santa Fe',                'Santa Fe',                        NULL,           'Centro'),
  ('Rafaela',                 'Santa Fe',                        NULL,           'Centro'),
  ('Venado Tuerto',           'Santa Fe',                        NULL,           'Centro'),
  ('Reconquista',             'Santa Fe',                        NULL,           'Centro'),

  -- Entre Ríos (Centro)
  ('Paraná',                  'Entre Ríos',                      NULL, 'Centro'),
  ('Concordia',               'Entre Ríos',                      NULL, 'Centro'),
  ('Gualeguaychú',            'Entre Ríos',                      NULL, 'Centro'),

  -- Cuyo
  ('Mendoza',                 'Mendoza',                         'Gran Mendoza', 'Cuyo'),
  ('Godoy Cruz',              'Mendoza',                         'Gran Mendoza', 'Cuyo'),
  ('San Rafael',              'Mendoza',                         NULL,           'Cuyo'),
  ('San Juan',                'San Juan',                        NULL,           'Cuyo'),
  ('San Luis',                'San Luis',                        NULL,           'Cuyo'),
  ('Villa Mercedes',          'San Luis',                        NULL,           'Cuyo'),

  -- NOA
  ('San Miguel de Tucumán',   'Tucumán',                         NULL, 'NOA'),
  ('Tucumán',                 'Tucumán',                         NULL, 'NOA'),
  ('Salta',                   'Salta',                           NULL, 'NOA'),
  ('San Salvador de Jujuy',   'Jujuy',                           NULL, 'NOA'),
  ('Jujuy',                   'Jujuy',                           NULL, 'NOA'),
  ('Santiago del Estero',     'Santiago del Estero',             NULL, 'NOA'),
  ('La Banda',                'Santiago del Estero',             NULL, 'NOA'),
  ('Catamarca',               'Catamarca',                       NULL, 'NOA'),
  ('San Fernando del Valle de Catamarca', 'Catamarca',           NULL, 'NOA'),
  ('La Rioja',                'La Rioja',                        NULL, 'NOA'),

  -- NEA
  ('Resistencia',             'Chaco',                           NULL, 'NEA'),
  ('Corrientes',              'Corrientes',                      NULL, 'NEA'),
  ('Posadas',                 'Misiones',                        NULL, 'NEA'),
  ('Formosa',                 'Formosa',                         NULL, 'NEA'),
  ('Goya',                    'Corrientes',                      NULL, 'NEA'),
  ('Oberá',                   'Misiones',                        NULL, 'NEA'),

  -- Patagonia
  ('Neuquén',                 'Neuquén',                         NULL, 'Patagonia'),
  ('Cipolletti',              'Río Negro',                       NULL, 'Patagonia'),
  ('General Roca',            'Río Negro',                       NULL, 'Patagonia'),
  ('Viedma',                  'Río Negro',                       NULL, 'Patagonia'),
  ('San Carlos de Bariloche', 'Río Negro',                       NULL, 'Patagonia'),
  ('Bariloche',               'Río Negro',                       NULL, 'Patagonia'),
  ('Comodoro Rivadavia',      'Chubut',                          NULL, 'Patagonia'),
  ('Trelew',                  'Chubut',                          NULL, 'Patagonia'),
  ('Puerto Madryn',           'Chubut',                          NULL, 'Patagonia'),
  ('Río Gallegos',            'Santa Cruz',                      NULL, 'Patagonia'),
  ('Ushuaia',                 'Tierra del Fuego',                NULL, 'Patagonia'),
  ('Río Grande',              'Tierra del Fuego',                NULL, 'Patagonia'),

  -- Pampeana (La Pampa)
  ('Santa Rosa',              'La Pampa',                        NULL, 'Pampeana'),
  ('General Pico',            'La Pampa',                        NULL, 'Pampeana')
ON CONFLICT (ciudad) DO UPDATE SET
  provincia       = EXCLUDED.provincia,
  gran_area       = EXCLUDED.gran_area,
  region_nacional = EXCLUDED.region_nacional;
