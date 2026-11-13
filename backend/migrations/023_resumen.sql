-- Finanzas: última configuración del resumen de cada persona en cada grupo (período, frecuencia, cuentas, vista)
CREATE TABLE finance_summary_prefs (
  family_id  uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  config     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);
