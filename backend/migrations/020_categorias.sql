-- Finanzas: categorías de los movimientos (el "Tipo" del Excel). Son del grupo y valen para todas sus cuentas.
-- No definen si el dinero entra o sale: una categoría puede tener entradas y salidas.
CREATE TABLE movement_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  icon        text NOT NULL,
  color       text NOT NULL,
  -- Deshabilitada: no se ofrece al crear movimientos, pero sigue en el resumen y los filtros
  disabled_at timestamptz,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Sin nombres repetidos en el grupo (sin distinguir mayúsculas)
CREATE UNIQUE INDEX movement_categories_name_idx ON movement_categories (family_id, lower(name));

-- Un movimiento con categoría no deja borrarla: antes hay que pasar sus movimientos a otra
ALTER TABLE account_movements ADD COLUMN category_id uuid REFERENCES movement_categories (id) ON DELETE RESTRICT;
CREATE INDEX account_movements_category_idx ON account_movements (category_id);

-- Las categorías iniciales se crean una sola vez por grupo (si luego se borran todas, no vuelven)
ALTER TABLE families ADD COLUMN categories_seeded boolean NOT NULL DEFAULT false;
