-- Listas del grupo familiar y sus ítems.
-- Los ids pueden venir del cliente (crear sin conexión): así reenviar la misma creación no duplica.
CREATE TABLE lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  type        text NOT NULL CHECK (type IN ('todo', 'shopping', 'other')),
  color       text NOT NULL,
  icon        text NOT NULL,
  is_private  boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lists_family_idx ON lists (family_id, archived_at);

-- Fijar es personal: cada usuario fija las que le importan
CREATE TABLE list_pins (
  list_id uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, user_id)
);

CREATE TABLE list_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id      uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  text         text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
  note         text CHECK (char_length(note) <= 500),
  quantity     text CHECK (char_length(quantity) <= 30),
  category     text CHECK (char_length(category) <= 40),
  assignee_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  due_date     date,
  -- Orden manual: número fraccionario, mover un ítem solo cambia su propio valor
  position     double precision NOT NULL,
  completed_at timestamptz,
  completed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_items_list_idx ON list_items (list_id, position);
