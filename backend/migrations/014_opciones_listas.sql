-- Opciones de los elementos de cada lista. El tipo pasa a ser un punto de partida:
-- Compras = cantidad, categoría y compras; Por hacer = responsable, fecha y subtareas; Otra = las que se elijan.
ALTER TABLE lists ADD COLUMN features text[] NOT NULL DEFAULT '{}'
  CHECK (features <@ ARRAY['quantity', 'category', 'purchases', 'assignee', 'due', 'subtasks']::text[]);

UPDATE lists SET features = ARRAY['quantity', 'category', 'purchases'] WHERE type = 'shopping';
UPDATE lists SET features = ARRAY['assignee', 'due', 'subtasks'] WHERE type = 'todo';
