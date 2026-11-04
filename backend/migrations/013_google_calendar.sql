-- Conexión con Google Calendar (una cuenta por persona). El refresh token se guarda cifrado.
CREATE TABLE google_accounts (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  google_email text NOT NULL,
  refresh_token_enc text NOT NULL,
  -- Calendario secundario "Our House" creado por la app (permiso calendar.app.created)
  calendar_id text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

-- Evento de cada tarea en el calendario de quien la recibe. Sin FK a list_items: al borrar la tarea
-- hay que poder borrar también el evento en Google (lo hace la sincronización).
CREATE TABLE calendar_events (
  item_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES google_accounts (user_id) ON DELETE CASCADE,
  event_id text NOT NULL,
  -- Huella del contenido enviado: si no cambió, no se vuelve a llamar a Google
  payload_hash text NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

-- El aviso "conecta tu Google Calendar" al poner una fecha se puede ocultar para siempre
ALTER TABLE users ADD COLUMN calendar_prompt_dismissed boolean NOT NULL DEFAULT false;
