-- ============================================================================
-- Seed · analytics.insight_templates (copy en español)
-- ============================================================================
-- Plantillas de copy para los insights generados por analytics.render_insights.
-- Usa printf-style %s para sustituir el ámbito ("Córdoba", "AMBA", "Centro", "AR").
-- Tres severidades: positive (verde), neutral (gris), attention (ambar).
--
-- Reglas de condición:
--   - p10_low   : valor ≤ p10 del cohort (en el 10% más bajo)
--   - p25_low   : valor ≤ p25 (en el cuartil inferior)
--   - p75_high  : valor ≥ p75 (en el cuartil superior)
--   - p90_high  : valor ≥ p90 (en el 10% más alto)
-- Iteraciones de copy se pueden hacer sin migration (UPDATE a esta tabla).

INSERT INTO analytics.insight_templates (metrica, condicion, severity, template_es) VALUES
  -- ─── Precio inicial ──────────────────────────────────────────────────────
  ('precio_avg_inicial', 'p10_low',  'attention',
    'Tu consulta inicial está entre las más bajas de %s. Probá revisarla — podrías estar dejando ingresos sobre la mesa.'),
  ('precio_avg_inicial', 'p25_low',  'attention',
    'Tu consulta inicial está por debajo del 75% de colegas en %s. Considerá un ajuste gradual.'),
  ('precio_avg_inicial', 'p75_high', 'positive',
    'Tu consulta inicial está entre las mejor pagas de %s. Mantenés un pricing sólido.'),
  ('precio_avg_inicial', 'p90_high', 'positive',
    'Tu consulta inicial está en el top 10% de %s. Tu propuesta de valor lo respalda.'),

  -- ─── Precio seguimiento ──────────────────────────────────────────────────
  ('precio_avg_seguimiento', 'p10_low',  'attention',
    'Tu seguimiento está entre los más bajos de %s. Si el servicio es comparable, hay margen para ajustar.'),
  ('precio_avg_seguimiento', 'p25_low',  'neutral',
    'Tu seguimiento está bajo la mediana de %s. Revisalo periódicamente.'),
  ('precio_avg_seguimiento', 'p75_high', 'positive',
    'Tu seguimiento se posiciona en el cuartil superior de %s.'),
  ('precio_avg_seguimiento', 'p90_high', 'positive',
    'Tu seguimiento está en el top 10% de %s. Confianza alta en tu propuesta.'),

  -- ─── Duración promedio ───────────────────────────────────────────────────
  ('duracion_avg_min', 'p75_high', 'neutral',
    'Tus sesiones son más largas que la mediana en %s. Si es buscado, ignorá; si no, evaluá agenda más densa.'),
  ('duracion_avg_min', 'p90_high', 'neutral',
    'Tus sesiones son notablemente más largas que el 90% de %s. Considerá si querés re-balancear agenda.'),
  ('duracion_avg_min', 'p25_low',  'neutral',
    'Tus sesiones son más cortas que la mayoría en %s. Si los pacientes responden, ese es tu estilo.'),
  ('duracion_avg_min', 'p10_low',  'attention',
    'Tus sesiones están entre las más cortas de %s. Verificá que cubrís lo necesario.'),

  -- ─── Tasa de no-show ─────────────────────────────────────────────────────
  ('tasa_no_show', 'p10_low',  'positive',
    'Tu tasa de inasistencias es mejor que el 90% de colegas en %s. Tu manejo de recordatorios funciona.'),
  ('tasa_no_show', 'p25_low',  'positive',
    'Tu tasa de inasistencias está mejor que 3 de cada 4 colegas en %s.'),
  ('tasa_no_show', 'p75_high', 'attention',
    'Tu tasa de inasistencias está más alta que la mediana en %s. Probemos reforzar recordatorios o pedir seña.'),
  ('tasa_no_show', 'p90_high', 'attention',
    'Tu tasa de inasistencias está en el 10% más alto de %s. Es prioritario activar recordatorios automáticos.'),

  -- ─── Tasa de cancelación ─────────────────────────────────────────────────
  ('tasa_cancelacion', 'p10_low',  'positive',
    'Tus cancelaciones están entre las más bajas de %s.'),
  ('tasa_cancelacion', 'p25_low',  'positive',
    'Pocas cancelaciones — mejor que 3 de cada 4 colegas en %s.'),
  ('tasa_cancelacion', 'p75_high', 'attention',
    'Tus cancelaciones están por encima de la mediana de %s. Mirá qué patrón se repite.'),
  ('tasa_cancelacion', 'p90_high', 'attention',
    'Tus cancelaciones están en el 10% más alto de %s. Una política de aviso 24h con seña ayuda.')
ON CONFLICT (metrica, condicion) DO UPDATE SET
  severity      = EXCLUDED.severity,
  template_es   = EXCLUDED.template_es;
