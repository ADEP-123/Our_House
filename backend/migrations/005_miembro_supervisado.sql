-- Nuevo rol: miembro supervisado (menores de edad). Los líderes pueden ver sus listas privadas.
ALTER TABLE family_members DROP CONSTRAINT family_members_role_check;
ALTER TABLE family_members ADD CONSTRAINT family_members_role_check CHECK (role IN ('leader', 'member', 'supervised'));
