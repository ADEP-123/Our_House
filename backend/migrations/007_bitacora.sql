-- Bitácora del grupo: cada acción sobre listas e ítems. No se borra nunca (solo si se elimina el grupo).
CREATE TABLE activity_log (
  id               bigserial PRIMARY KEY,
  family_id        uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  actor_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Copia del apodo: el registro se entiende aunque la persona cambie de apodo o se vaya
  actor_nickname   text,
  action           text NOT NULL,
  -- Sin clave foránea a propósito: el registro sobrevive al borrado de la lista o del ítem
  list_id          uuid,
  list_name        text,
  item_id          uuid,
  item_text        text,
  -- Dueño si la lista era privada al momento de la acción (para ocultar el contenido a los demás)
  private_owner_id uuid,
  details          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_family_idx ON activity_log (family_id, id DESC);
CREATE INDEX activity_log_list_idx ON activity_log (family_id, list_id, id DESC);
