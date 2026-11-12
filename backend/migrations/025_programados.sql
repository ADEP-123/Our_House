-- Finanzas: movimientos programados (gastos, ingresos, transferencias y apartados que se repiten).

CREATE TABLE scheduled_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  -- in / out: movimiento de la cuenta; transfer: hacia to_account_id; set_aside: apartar para un proyecto de ahorro
  kind              text NOT NULL CHECK (kind IN ('in', 'out', 'transfer', 'set_aside')),
  to_account_id     uuid REFERENCES accounts (id) ON DELETE CASCADE,
  savings_project_id uuid REFERENCES savings_projects (id) ON DELETE CASCADE,
  category_id       uuid REFERENCES movement_categories (id) ON DELETE SET NULL,
  amount            numeric(14, 2) NOT NULL CHECK (amount > 0),
  description       text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  -- auto: se registra solo; confirm: queda pendiente para poner el monto real
  mode              text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm')),
  -- Regla de repetición de la Fase 5 (freq, interval, weekdays, start, until, count)
  rule              jsonb NOT NULL,
  -- Próxima fecha que toca; NULL cuando terminó
  next_date         date,
  times_done        int NOT NULL DEFAULT 0,
  -- Avisos: días antes (NULL = sin aviso) y al registrarse
  remind_days       int CHECK (remind_days BETWEEN 0 AND 30),
  notify_done       boolean NOT NULL DEFAULT true,
  last_reminded_for date,
  -- Pausa: manual, cuenta archivada o sin permiso; ended_at: llegó a la fecha final o a las veces pedidas
  paused_at         timestamptz,
  pause_reason      text CHECK (pause_reason IN ('manual', 'archived', 'permission', 'missing')),
  ended_at          timestamptz,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'transfer') = (to_account_id IS NOT NULL)),
  CHECK ((kind = 'set_aside') = (savings_project_id IS NOT NULL)),
  CHECK (kind IN ('in', 'out') OR category_id IS NULL)
);
CREATE INDEX scheduled_movements_family_idx ON scheduled_movements (family_id);
CREATE INDEX scheduled_movements_due_idx ON scheduled_movements (next_date) WHERE paused_at IS NULL AND ended_at IS NULL;

-- Cada vez que tocó: registrada, pendiente de confirmar, saltada o fallida (ej. sin disponible para apartar)
CREATE TABLE scheduled_occurrences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES scheduled_movements (id) ON DELETE CASCADE,
  due_date    date NOT NULL,
  status      text NOT NULL CHECK (status IN ('done', 'pending', 'skipped', 'failed')),
  amount      numeric(14, 2),
  movement_id uuid REFERENCES account_movements (id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (schedule_id, due_date)
);
CREATE INDEX scheduled_occurrences_pending_idx ON scheduled_occurrences (schedule_id) WHERE status = 'pending';

-- Movimientos creados por un programado ("🔁 programado")
ALTER TABLE account_movements ADD COLUMN schedule_id uuid REFERENCES scheduled_movements (id) ON DELETE SET NULL;

-- Correos de programados: antes de cobrar, al registrarse y pendientes de confirmar
ALTER TABLE users ADD COLUMN email_scheduled boolean NOT NULL DEFAULT true;
