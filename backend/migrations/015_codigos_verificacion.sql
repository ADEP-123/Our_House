-- Códigos de 6 dígitos enviados al correo para confirmar acciones sensibles (ej. ver listas secretas).
-- Se guarda solo su huella. Vencen a los 10 minutos, se usan una vez y admiten 5 intentos.
CREATE TABLE verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('secrets')),
  code_hash text NOT NULL,
  attempts smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_codes_user_idx ON verification_codes (user_id, purpose, created_at DESC);
