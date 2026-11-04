-- Moneda del grupo (la elige un líder) para el gasto de las listas de compras
ALTER TABLE families ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$');

-- Cantidad en número + unidad, y lo comprado hasta ahora (compras parciales que se suman)
ALTER TABLE list_items
  ADD COLUMN amount numeric(12, 3) CHECK (amount > 0),
  ADD COLUMN unit text CHECK (char_length(unit) <= 20),
  ADD COLUMN purchased numeric(12, 3) CHECK (purchased > 0),
  ADD COLUMN spent numeric(12, 2) CHECK (spent >= 0),
  -- Última compra registrada: un reenvío de la misma compra (cola sin conexión) no suma dos veces
  ADD COLUMN last_purchase_id uuid;

-- La cantidad de texto ("2 L", "4", "1,5 kg") pasa a número + unidad
UPDATE list_items
   SET amount = replace(substring(quantity FROM '^\s*([0-9]+(?:[.,][0-9]+)?)'), ',', '.')::numeric,
       unit = left(nullif(trim(regexp_replace(quantity, '^\s*[0-9]+(?:[.,][0-9]+)?\s*', '')), ''), 20)
 WHERE quantity ~ '^\s*[0-9]+(?:[.,][0-9]+)?' AND replace(substring(quantity FROM '^\s*([0-9]+(?:[.,][0-9]+)?)'), ',', '.')::numeric > 0;

-- Lo que no empieza con un número ("un paquete") se conserva en la nota
UPDATE list_items
   SET note = left(CASE WHEN note IS NULL THEN quantity ELSE note || ' · ' || quantity END, 500)
 WHERE quantity IS NOT NULL AND amount IS NULL AND trim(quantity) <> '';

-- Lo ya marcado como comprado cuenta como comprado completo
UPDATE list_items SET purchased = amount WHERE completed_at IS NOT NULL AND amount IS NOT NULL;

ALTER TABLE list_items DROP COLUMN quantity;
