-- Finanzas + listas de compras: "Registrar pago" junta lo pagado desde el último pago en un solo movimiento.

-- Lo que la lista recuerda para el próximo pago: la categoría y la última cuenta usada
ALTER TABLE lists
  ADD COLUMN payment_category_id uuid REFERENCES movement_categories (id) ON DELETE SET NULL,
  ADD COLUMN payment_account_id  uuid REFERENCES accounts (id) ON DELETE SET NULL;

-- Lo pagado de vueltas anteriores de un artículo que se repite y que aún no entra en un pago
-- (la repetición borra lo pagado del artículo; esto lo conserva para el próximo pago)
ALTER TABLE list_items ADD COLUMN unpaid numeric(12, 2) CHECK (unpaid > 0);

-- Cada pago registrado (o "No registrar": registered = false, sin movimiento)
CREATE TABLE list_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     uuid NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  movement_id uuid REFERENCES account_movements (id) ON DELETE SET NULL,
  account_id  uuid REFERENCES accounts (id) ON DELETE SET NULL,
  amount      numeric(14, 2) NOT NULL CHECK (amount >= 0),
  items_count int NOT NULL CHECK (items_count >= 0),
  registered  boolean NOT NULL,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_payments_list_idx ON list_payments (list_id, created_at DESC);
CREATE INDEX list_payments_movement_idx ON list_payments (movement_id) WHERE movement_id IS NOT NULL;

-- Qué parte de lo pagado de cada artículo entró en cada pago (lo pendiente = spent + unpaid - lo ya incluido)
CREATE TABLE list_payment_items (
  payment_id uuid NOT NULL REFERENCES list_payments (id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES list_items (id) ON DELETE CASCADE,
  amount     numeric(12, 2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, item_id)
);
CREATE INDEX list_payment_items_item_idx ON list_payment_items (item_id);
