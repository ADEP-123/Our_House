-- Finanzas: entradas, salidas y ajustes de saldo, con borrado reversible e historial de cambios.

-- Ajuste de saldo: como el saldo inicial, el monto lleva signo (sube o baja el saldo hasta el real)
ALTER TABLE account_movements DROP CONSTRAINT account_movements_kind_check;
ALTER TABLE account_movements ADD CONSTRAINT account_movements_kind_check CHECK (kind IN ('opening', 'in', 'out', 'adjust'));
ALTER TABLE account_movements DROP CONSTRAINT account_movements_check;
ALTER TABLE account_movements ADD CONSTRAINT account_movements_amount_check
  CHECK (amount <> 0 AND (kind IN ('opening', 'adjust') OR amount > 0));

ALTER TABLE account_movements
  -- Borrado reversible (Deshacer); el número del movimiento no se reutiliza
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN updated_by uuid REFERENCES users (id) ON DELETE SET NULL;

-- Historial de cada movimiento: quién y qué cambió
CREATE TABLE account_movement_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  movement_id uuid NOT NULL REFERENCES account_movements (id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'restored')),
  -- updated: { campo: [antes, después] }
  changes     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_movement_history_movement_idx ON account_movement_history (movement_id, id);

-- Preferencias de cada persona en cada cuenta: columnas ocultas
CREATE TABLE account_prefs (
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  hidden_columns text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (account_id, user_id)
);
