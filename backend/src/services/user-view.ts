import type { UserRow } from '../repositories/users.repository.js';

/** Lo que el frontend puede ver del usuario (nunca el hash ni los contadores internos). */
export function toUserView(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    locale: user.locale,
    timezone: user.timezone,
  };
}

export type UserView = ReturnType<typeof toUserView>;
