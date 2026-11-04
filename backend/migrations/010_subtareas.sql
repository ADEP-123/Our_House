-- Subtareas: un solo nivel, dentro de la misma lista. Borrar la tarea borra sus subtareas.
ALTER TABLE list_items ADD COLUMN parent_id uuid REFERENCES list_items (id) ON DELETE CASCADE;
CREATE INDEX list_items_parent_idx ON list_items (parent_id) WHERE parent_id IS NOT NULL;
