-- Grupos familiares, sus miembros (con rol) e invitaciones
CREATE TABLE families (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  avatar_url    text,
  avatar_preset text,
  invite_code   text NOT NULL UNIQUE,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_members (
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('leader', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);
CREATE INDEX family_members_user_id_idx ON family_members (user_id);

-- "expirada" no se guarda: es una invitación pendiente cuya fecha ya pasó
CREATE TABLE family_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  invited_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  email           citext NOT NULL,
  invited_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz
);
CREATE UNIQUE INDEX family_invitations_one_pending_idx ON family_invitations (family_id, email) WHERE status = 'pending';
CREATE INDEX family_invitations_email_idx ON family_invitations (email) WHERE status = 'pending';
CREATE INDEX family_invitations_user_idx ON family_invitations (invited_user_id) WHERE status = 'pending';
