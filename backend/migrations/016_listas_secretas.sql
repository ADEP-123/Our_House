-- Listas secretas: elementos con título visible y campos cifrados (usuario, contraseña, PIN...).
ALTER TABLE lists DROP CONSTRAINT lists_type_check,
  ADD CONSTRAINT lists_type_check CHECK (type IN ('todo', 'shopping', 'other', 'secret'));

CREATE TABLE secret_items (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- Campos cifrados con AES-256-GCM y una clave propia de este elemento (ver backend/src/lib/vault.ts)
  payload_enc text NOT NULL,
  position double precision NOT NULL,
  -- Solo quien lo creó lo edita o lo borra; si borra su cuenta, sus elementos se borran con ella
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX secret_items_list_idx ON secret_items (list_id, position);

-- Aviso por correo cuando otra persona ve la información secreta de una lista donde tienes elementos
ALTER TABLE users ADD COLUMN email_secret_views boolean NOT NULL DEFAULT true;
