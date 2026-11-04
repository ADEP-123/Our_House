-- Recordatorios por correo de tareas con fecha límite.
-- Valores por defecto de cada persona (Perfil > Notificaciones): a qué hora, desde cuántos días antes y cada cuántos días.
ALTER TABLE users
  ADD COLUMN email_reminders boolean NOT NULL DEFAULT true,
  ADD COLUMN reminder_hour smallint NOT NULL DEFAULT 8 CHECK (reminder_hour BETWEEN 0 AND 23),
  ADD COLUMN reminder_start_days smallint NOT NULL DEFAULT 3 CHECK (reminder_start_days BETWEEN 0 AND 60),
  ADD COLUMN reminder_every_days smallint NOT NULL DEFAULT 1 CHECK (reminder_every_days BETWEEN 1 AND 30);

-- Cada tarea puede cambiar esos valores (null = los de quien la recibe) o apagarlos
ALTER TABLE list_items
  ADD COLUMN reminder_start_days smallint CHECK (reminder_start_days BETWEEN 0 AND 60),
  ADD COLUMN reminder_every_days smallint CHECK (reminder_every_days BETWEEN 1 AND 30),
  ADD COLUMN reminders_off boolean NOT NULL DEFAULT false;

-- Un recordatorio por tarea, persona y día (el envío corre cada hora y puede repetirse)
CREATE TABLE reminder_sends (
  item_id uuid NOT NULL REFERENCES list_items (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  local_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id, local_date)
);
