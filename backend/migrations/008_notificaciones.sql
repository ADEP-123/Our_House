-- Preferencias de correo por persona (se cambian en Perfil > Notificaciones)
ALTER TABLE users
  ADD COLUMN email_new_lists boolean NOT NULL DEFAULT true,
  ADD COLUMN email_assignments boolean NOT NULL DEFAULT true;
