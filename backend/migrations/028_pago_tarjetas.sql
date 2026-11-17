-- Finanzas: día de pago y día de corte (opcional) de las tarjetas de crédito, con avisos por correo
-- y un evento por mes en el calendario "Our House" de Google de quien creó la tarjeta.

ALTER TABLE accounts
  ADD COLUMN payment_day smallint CHECK (payment_day BETWEEN 1 AND 31),
  ADD COLUMN cut_day     smallint CHECK (cut_day BETWEEN 1 AND 31),
  ADD CONSTRAINT accounts_payment_days_check
    CHECK ((kind = 'credit' OR (payment_day IS NULL AND cut_day IS NULL)) AND (cut_day IS NULL OR payment_day IS NOT NULL));

-- Correos de "pago pendiente": uno por persona y por día (en su zona horaria)
CREATE TABLE card_payment_sends (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  local_date date NOT NULL,
  due_date   date NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id, local_date)
);

-- Evento "💳 Pagar Visa · 180,00 US$" de cada fecha de pago, en el calendario de quien creó la tarjeta
CREATE TABLE card_calendar_events (
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  due_date     date NOT NULL,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id     text NOT NULL,
  payload_hash text NOT NULL,
  PRIMARY KEY (account_id, due_date)
);
