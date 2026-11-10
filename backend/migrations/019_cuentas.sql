-- Finanzas: cuentas físicas del grupo (banco, efectivo, tarjeta de crédito, ahorro) y sus permisos.
-- La moneda es la del grupo (families.currency); no hay conversión.
CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  -- Quien la creó y la administra (permisos, archivar, borrar). NULL: salió del grupo y la administran los líderes.
  owner_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description   text CHECK (char_length(description) <= 280),
  kind          text NOT NULL CHECK (kind IN ('bank', 'cash', 'credit', 'savings')),
  -- Prefijo del ID visible de los movimientos (T0001)
  prefix        text NOT NULL CHECK (prefix ~ '^[A-Z0-9]{1,4}$'),
  -- Cupo: solo tarjetas de crédito
  credit_limit  numeric(14, 2) CHECK (credit_limit >= 0),
  -- Ver: todo el grupo, personas elegidas (account_access) o solo quien la creó
  view_mode     text NOT NULL DEFAULT 'family' CHECK (view_mode IN ('family', 'members', 'private')),
  -- Editar: por rol (edit_roles) o personas elegidas (account_access.can_edit)
  edit_mode     text NOT NULL DEFAULT 'roles' CHECK (edit_mode IN ('roles', 'members')),
  edit_roles    text[] NOT NULL DEFAULT '{leader,member}' CHECK (edit_roles <@ '{leader,member,supervised}'),
  -- Último número de movimiento usado: los números no se reutilizan aunque se borre el movimiento
  last_number   integer NOT NULL DEFAULT 0,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'credit' OR credit_limit IS NULL)
);
CREATE INDEX accounts_family_idx ON accounts (family_id, archived_at);
-- Un prefijo por grupo, así el ID visible (T0001) no se repite entre cuentas
CREATE UNIQUE INDEX accounts_prefix_idx ON accounts (family_id, prefix);

-- Personas elegidas: quién ve (view_mode = 'members') y quién edita (edit_mode = 'members')
CREATE TABLE account_access (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  can_view   boolean NOT NULL DEFAULT true,
  can_edit   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX account_access_user_idx ON account_access (user_id);

-- Movimientos. En este paso solo el saldo inicial; entradas, salidas y transferencias llegan con su feat.
-- El saldo inicial puede ser negativo (deuda de una tarjeta, sobregiro); el resto siempre positivo.
CREATE TABLE account_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  number      integer NOT NULL CHECK (number > 0),
  kind        text NOT NULL CHECK (kind IN ('opening', 'in', 'out')),
  amount      numeric(14, 2) NOT NULL CHECK (amount <> 0 AND (kind = 'opening' OR amount > 0)),
  date        date NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, number)
);
CREATE INDEX account_movements_account_idx ON account_movements (account_id, date, created_at);
CREATE UNIQUE INDEX account_movements_one_opening_idx ON account_movements (account_id) WHERE kind = 'opening';
