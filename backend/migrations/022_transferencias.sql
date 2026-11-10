-- Finanzas: transferencias entre cuentas del grupo (incluido el pago de una tarjeta de crédito).
-- Son dos movimientos enlazados por transfer_id: una salida (transfer_out) y una entrada (transfer_in).
-- No llevan categoría y en el resumen no cuentan como gasto ni como ingreso.
ALTER TABLE account_movements DROP CONSTRAINT account_movements_kind_check;
ALTER TABLE account_movements ADD CONSTRAINT account_movements_kind_check
  CHECK (kind IN ('opening', 'in', 'out', 'adjust', 'transfer_in', 'transfer_out'));

ALTER TABLE account_movements ADD COLUMN transfer_id uuid;
ALTER TABLE account_movements ADD CONSTRAINT account_movements_transfer_check
  CHECK ((kind IN ('transfer_in', 'transfer_out')) = (transfer_id IS NOT NULL) AND (transfer_id IS NULL OR category_id IS NULL));
-- Cada transferencia tiene exactamente una salida y una entrada
CREATE UNIQUE INDEX account_movements_transfer_idx ON account_movements (transfer_id, kind) WHERE transfer_id IS NOT NULL;
