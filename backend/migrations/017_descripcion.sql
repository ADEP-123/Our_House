-- La nota de una línea pasa a ser una descripción de varias líneas (hasta 2000 caracteres)
ALTER TABLE list_items RENAME COLUMN note TO description;
ALTER TABLE list_items DROP CONSTRAINT list_items_note_check,
  ADD CONSTRAINT list_items_description_check CHECK (char_length(description) <= 2000);
