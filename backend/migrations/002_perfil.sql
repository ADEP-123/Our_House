-- Datos personales y avatar del usuario
ALTER TABLE users
  ADD COLUMN first_name    text,
  ADD COLUMN last_name     text,
  ADD COLUMN avatar_url    text,
  ADD COLUMN avatar_preset text;
