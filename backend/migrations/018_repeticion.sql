-- Tareas que se repiten. Con fecha: al completarse pasan a la siguiente fecha.
-- Sin fecha (ej. "Leche cada semana"): quedan hechas hasta reopen_on y entonces vuelven a pendiente.
ALTER TABLE lists DROP CONSTRAINT lists_features_check,
  ADD CONSTRAINT lists_features_check
  CHECK (features <@ ARRAY['quantity', 'category', 'purchases', 'assignee', 'due', 'subtasks', 'repeat']::text[]);

-- "Por hacer" y "Compras" traen la repetición activada
UPDATE lists SET features = array_append(features, 'repeat') WHERE type IN ('todo', 'shopping');

ALTER TABLE list_items
  -- {freq, interval, weekdays?, from: schedule|completion, start, until?, count?} (ver backend/src/lib/recurrence.ts)
  ADD COLUMN repeat jsonb,
  -- Veces que se hizo (para "termina después de N veces")
  ADD COLUMN repeat_done integer NOT NULL DEFAULT 0,
  -- Turnos: personas que se van alternando como responsables, en orden
  ADD COLUMN rotation uuid[],
  ADD COLUMN rotation_index integer NOT NULL DEFAULT 0,
  ADD COLUMN reopen_on date;

CREATE INDEX list_items_reopen_idx ON list_items (reopen_on) WHERE reopen_on IS NOT NULL;
