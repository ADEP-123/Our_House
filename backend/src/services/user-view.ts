import type { UserRow } from '../repositories/users.repository.js';

/** Lo que el frontend puede ver del usuario (nunca el hash ni los contadores internos). */
export function toUserView(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    firstName: user.first_name,
    lastName: user.last_name,
    avatarUrl: user.avatar_url,
    avatarPreset: user.avatar_preset,
    theme: user.theme,
    locale: user.locale,
    timezone: user.timezone,
    notifications: {
      newLists: user.email_new_lists,
      assignments: user.email_assignments,
      reminders: user.email_reminders,
    },
    /** Recordatorios de tareas con fecha: valores por defecto de esta persona */
    reminders: {
      hour: user.reminder_hour,
      startDays: user.reminder_start_days,
      everyDays: user.reminder_every_days,
    },
    /** Ya no mostrar el aviso de conectar Google Calendar al poner una fecha */
    calendarPromptDismissed: user.calendar_prompt_dismissed,
  };
}

export type UserView = ReturnType<typeof toUserView>;
