-- Finanzas: proyectos de ahorro, presupuesto mensual por categoría y aviso de disponible bajo.

-- Proyectos de ahorro del grupo. El dinero no se mueve: se aparta dentro de una cuenta (savings_entries)
CREATE TABLE savings_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  icon             text NOT NULL,
  -- Meta y fecha meta, opcionales
  goal             numeric(14, 2) CHECK (goal > 0),
  target_date      date,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Cerrado: lo apartado se liberó y ya no recibe más
  closed_at        timestamptz,
  -- Ya se avisó que llegó a la meta (una sola vez)
  goal_notified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX savings_projects_family_idx ON savings_projects (family_id, closed_at);

-- Apartar y liberar: lo apartado de un proyecto en una cuenta es apartado - liberado - gastado del ahorro
CREATE TABLE savings_entries (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES savings_projects (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('set_aside', 'release')),
  amount     numeric(14, 2) NOT NULL CHECK (amount > 0),
  actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX savings_entries_project_idx ON savings_entries (project_id, account_id);
CREATE INDEX savings_entries_account_idx ON savings_entries (account_id);

-- Gastar del ahorro: una salida que se paga con lo apartado de un proyecto
ALTER TABLE account_movements ADD COLUMN savings_project_id uuid REFERENCES savings_projects (id) ON DELETE SET NULL;
ALTER TABLE account_movements ADD CONSTRAINT account_movements_savings_check CHECK (savings_project_id IS NULL OR kind = 'out');
CREATE INDEX account_movements_savings_idx ON account_movements (savings_project_id) WHERE savings_project_id IS NOT NULL;

-- Aviso cuando el disponible (saldo - ahorro) baja del umbral; se avisa una vez por cada vez que cruza
ALTER TABLE accounts
  ADD COLUMN low_balance_threshold numeric(14, 2) CHECK (low_balance_threshold >= 0),
  ADD COLUMN low_balance_notified_at timestamptz;

-- Presupuesto mensual por categoría (lo definen los líderes)
CREATE TABLE category_budgets (
  category_id uuid PRIMARY KEY REFERENCES movement_categories (id) ON DELETE CASCADE,
  amount      numeric(14, 2) NOT NULL CHECK (amount > 0),
  updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Avisos de presupuesto ya enviados: uno por categoría, mes y umbral (80 o 100 %)
CREATE TABLE budget_alerts (
  category_id uuid NOT NULL REFERENCES movement_categories (id) ON DELETE CASCADE,
  month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  threshold   int NOT NULL CHECK (threshold IN (80, 100)),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, month, threshold)
);

-- Correos de finanzas (presupuesto, metas de ahorro, disponible bajo)
ALTER TABLE users ADD COLUMN email_finance boolean NOT NULL DEFAULT true;
