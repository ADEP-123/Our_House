-- Finanzas: deudas del grupo ("Debo" y "Me deben"), con abonos, cambios de monto y avisos antes del vencimiento.
-- Las tarjetas de crédito aparecen en Deudas desde sus propios movimientos (no se guardan aquí).

CREATE TABLE debts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  -- Quien la creó y la administra; NULL: salió del grupo y la administran los líderes
  owner_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  -- owe: debo; owed: me deben
  direction      text NOT NULL CHECK (direction IN ('owe', 'owed')),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description    text CHECK (char_length(description) <= 280),
  -- A quién se le debe o quién debe
  counterparty   text NOT NULL CHECK (char_length(counterparty) BETWEEN 1 AND 60),
  -- Monto inicial; el saldo es este monto + aumentos − disminuciones − abonos
  amount         numeric(14, 2) NOT NULL CHECK (amount > 0),
  -- Fecha de pago (vencimiento), opcional
  due_date       date,
  -- Cuotas e interés, opcionales (el interés es informativo: se suma con "Cambiar monto")
  installments   smallint CHECK (installments BETWEEN 2 AND 600),
  interest_rate  numeric(6, 3) CHECK (interest_rate > 0 AND interest_rate <= 100),
  interest_period text CHECK (interest_period IN ('monthly', 'annual')),
  -- Ver: todo el grupo, personas elegidas (debt_viewers) o solo quien la creó
  view_mode      text NOT NULL DEFAULT 'family' CHECK (view_mode IN ('family', 'members', 'private')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((interest_rate IS NULL) = (interest_period IS NULL))
);
CREATE INDEX debts_family_idx ON debts (family_id);

CREATE TABLE debt_viewers (
  debt_id uuid NOT NULL REFERENCES debts (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (debt_id, user_id)
);

-- Historial: abonos y cambios de monto (intereses o ajustes). Un abono puede venir con su movimiento en una cuenta.
CREATE TABLE debt_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id     uuid NOT NULL REFERENCES debts (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('payment', 'increase', 'decrease')),
  amount      numeric(14, 2) NOT NULL CHECK (amount > 0),
  date        date NOT NULL,
  note        text CHECK (char_length(note) <= 200),
  movement_id uuid REFERENCES account_movements (id) ON DELETE SET NULL,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'payment' OR movement_id IS NULL)
);
CREATE INDEX debt_entries_debt_idx ON debt_entries (debt_id, date);

-- Correos antes del vencimiento: uno por persona y por día (en su zona horaria)
CREATE TABLE debt_reminder_sends (
  debt_id    uuid NOT NULL REFERENCES debts (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  local_date date NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (debt_id, user_id, local_date)
);
