-- Fecha límite con hora opcional. La hora se interpreta en la zona horaria de quien la puso (due_tz).
ALTER TABLE list_items
  ADD COLUMN due_time time,
  ADD COLUMN due_tz text,
  ADD CONSTRAINT list_items_due_time_needs_date CHECK (due_time IS NULL OR due_date IS NOT NULL);

-- Para "Mis tareas": lo asignado a cada persona
CREATE INDEX list_items_assignee_idx ON list_items (assignee_id) WHERE assignee_id IS NOT NULL AND completed_at IS NULL;
