export type Locale = 'es' | 'en';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

interface Layout {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plantilla única: HTML simple con estilos en línea (los clientes de correo ignoran CSS externo). */
function render(subject: string, layout: Layout): EmailContent {
  const button = layout.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(layout.action.url)}" style="background:#3F5F90;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(layout.action.label)}</a></p>
       <p style="font-size:13px;color:#5B6475;word-break:break-all">${escapeHtml(layout.action.url)}</p>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#F5F7FA;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1B2230">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-size:20px;font-weight:700;color:#3F5F90;margin:0 0 24px">Our House</p>
<div style="background:#ffffff;border:1px solid #E1E5EC;border-radius:20px;padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(layout.heading)}</h1>
${layout.paragraphs.map((p) => `<p style="line-height:1.55;margin:0 0 12px;white-space:pre-line">${escapeHtml(p)}</p>`).join('')}
${button}
${layout.footnote ? `<p style="font-size:13px;color:#5B6475;margin-top:20px">${escapeHtml(layout.footnote)}</p>` : ''}
</div></div></body></html>`;

  const text = [layout.heading, '', ...layout.paragraphs, layout.action ? `\n${layout.action.label}: ${layout.action.url}` : '', layout.footnote ?? '']
    .join('\n')
    .trim();

  return { subject, html, text };
}

const ignoreNote = {
  es: 'Si no fuiste tú, puedes ignorar este correo.',
  en: "If this wasn't you, you can ignore this email.",
};

const settingsNote = (locale: Locale, url: string) =>
  locale === 'en'
    ? `You can turn these emails off in your profile, under Notifications: ${url}`
    : `Puedes desactivar estos correos en tu perfil, en Notificaciones: ${url}`;

export const emailTemplates = {
  /** Código de verificación (el código va en el asunto para verlo directo en la notificación del celular) */
  verificationCode(locale: Locale, p: { nickname: string; code: string; purpose: 'secrets'; minutes: number }): EmailContent {
    if (locale === 'en') {
      return render(`${p.code} is your Our House code`, {
        heading: `Your code: ${p.code}`,
        paragraphs: [`${p.nickname}, use it to see the secret information in a list. It expires in ${p.minutes} minutes and works only once.`],
        footnote: "If you didn't ask for it, someone may know your password: change it from your profile.",
      });
    }
    return render(`${p.code} es tu código de Our House`, {
      heading: `Tu código: ${p.code}`,
      paragraphs: [`${p.nickname}, úsalo para ver la información secreta de una lista. Vence en ${p.minutes} minutos y sirve una sola vez.`],
      footnote: 'Si no lo pediste, alguien podría conocer tu contraseña: cámbiala desde tu perfil.',
    });
  },

  /** Otra persona vio la información secreta de una lista donde tienes elementos */
  secretsViewed(locale: Locale, p: { viewer: string; list: string; url: string; settingsUrl: string }): EmailContent {
    if (locale === 'en') {
      return render(`${p.viewer} viewed the secret information in “${p.list}”`, {
        heading: 'Someone viewed your secrets',
        paragraphs: [`${p.viewer} unlocked the list “${p.list}”, where you have items, and can see their values.`, "If you didn't expect it, review who is in your group."],
        action: { label: 'Open list', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    return render(`${p.viewer} vio la información secreta de «${p.list}»`, {
      heading: 'Alguien vio tus secretos',
      paragraphs: [`${p.viewer} desbloqueó la lista «${p.list}», donde tienes elementos, y puede ver sus valores.`, 'Si no lo esperabas, revisa quiénes están en tu grupo.'],
      action: { label: 'Abrir lista', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },

  /** Lista nueva del grupo, o lista privada que pasó a ser del grupo */
  newList(locale: Locale, p: { author: string; list: string; family: string; madePublic: boolean; url: string; settingsUrl: string }): EmailContent {
    if (locale === 'en') {
      const what = p.madePublic ? `${p.author} shared the list “${p.list}”` : `${p.author} created the list “${p.list}”`;
      return render(`${what} in ${p.family}`, {
        heading: p.madePublic ? 'A list is now shared with the group' : 'New list in your group',
        paragraphs: [`${what} in ${p.family}. Everyone in the group can see it and check its items.`],
        action: { label: 'Open list', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    const what = p.madePublic ? `${p.author} compartió la lista «${p.list}»` : `${p.author} creó la lista «${p.list}»`;
    return render(`${what} en ${p.family}`, {
      heading: p.madePublic ? 'Una lista ahora es del grupo' : 'Nueva lista en tu grupo',
      paragraphs: [`${what} en ${p.family}. Todo el grupo puede verla y marcar sus ítems.`],
      action: { label: 'Abrir lista', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },

  /** Recordatorio de una tarea que vence pronto (o hoy) */
  reminder(
    locale: Locale,
    p: { task: string; description?: string | null; list: string; daysLeft: number; due: string; url: string; settingsUrl: string },
  ): EmailContent {
    const extra = p.description ? [p.description] : [];
    if (locale === 'en') {
      const when = p.daysLeft === 0 ? 'today' : p.daysLeft === 1 ? 'tomorrow' : `in ${p.daysLeft} days`;
      return render(`Reminder: “${p.task}” is due ${when}`, {
        heading: `“${p.task}” is due ${when}`,
        paragraphs: [`It's still pending in the list “${p.list}”.`, `Due: ${p.due}.`, ...extra],
        action: { label: 'Open list', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    const when = p.daysLeft === 0 ? 'hoy' : p.daysLeft === 1 ? 'mañana' : `en ${p.daysLeft} días`;
    return render(`Recordatorio: «${p.task}» vence ${when}`, {
      heading: `«${p.task}» vence ${when}`,
      paragraphs: [`Sigue pendiente en la lista «${p.list}».`, `Fecha límite: ${p.due}.`, ...extra],
      action: { label: 'Abrir lista', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },

  /** Alguien te asignó una tarea */
  assigned(locale: Locale, p: { author: string; task: string; list: string; due: string | null; url: string; settingsUrl: string }): EmailContent {
    if (locale === 'en') {
      return render(`${p.author} assigned you “${p.task}”`, {
        heading: 'You have a new task',
        paragraphs: [`${p.author} assigned you “${p.task}” in the list “${p.list}”.`, ...(p.due ? [`Due: ${p.due}.`] : [])],
        action: { label: 'See task', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    return render(`${p.author} te asignó «${p.task}»`, {
      heading: 'Tienes una tarea nueva',
      paragraphs: [`${p.author} te asignó «${p.task}» en la lista «${p.list}».`, ...(p.due ? [`Fecha límite: ${p.due}.`] : [])],
      action: { label: 'Ver tarea', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },

  verifyEmail(locale: Locale, p: { nickname: string; url: string }): EmailContent {
    return locale === 'en'
      ? render('Confirm your Our House account', {
          heading: `Welcome, ${p.nickname}`,
          paragraphs: ['Confirm your email to start using Our House. The link expires in 24 hours.'],
          action: { label: 'Confirm email', url: p.url },
          footnote: ignoreNote.en,
        })
      : render('Confirma tu cuenta de Our House', {
          heading: `Hola, ${p.nickname}`,
          paragraphs: ['Confirma tu correo para empezar a usar Our House. El enlace vence en 24 horas.'],
          action: { label: 'Confirmar correo', url: p.url },
          footnote: ignoreNote.es,
        });
  },

  resetPassword(locale: Locale, p: { nickname: string; url: string }): EmailContent {
    return locale === 'en'
      ? render('Reset your Our House password', {
          heading: 'Reset your password',
          paragraphs: [`${p.nickname}, we got a request to reset your password. The link expires in 1 hour.`],
          action: { label: 'Choose a new password', url: p.url },
          footnote: ignoreNote.en,
        })
      : render('Restablece tu contraseña de Our House', {
          heading: 'Restablece tu contraseña',
          paragraphs: [`${p.nickname}, recibimos una solicitud para cambiar tu contraseña. El enlace vence en 1 hora.`],
          action: { label: 'Elegir nueva contraseña', url: p.url },
          footnote: ignoreNote.es,
        });
  },

  confirmEmailChange(locale: Locale, p: { nickname: string; url: string }): EmailContent {
    return locale === 'en'
      ? render('Confirm your new email', {
          heading: 'Confirm your new email',
          paragraphs: [`${p.nickname}, confirm this address to use it in Our House. The link expires in 24 hours.`],
          action: { label: 'Confirm new email', url: p.url },
          footnote: ignoreNote.en,
        })
      : render('Confirma tu nuevo correo', {
          heading: 'Confirma tu nuevo correo',
          paragraphs: [`${p.nickname}, confirma esta dirección para usarla en Our House. El enlace vence en 24 horas.`],
          action: { label: 'Confirmar nuevo correo', url: p.url },
          footnote: ignoreNote.es,
        });
  },

  emailChangedNotice(locale: Locale, p: { nickname: string; newEmail: string }): EmailContent {
    return locale === 'en'
      ? render('Your Our House email changed', {
          heading: 'Your email changed',
          paragraphs: [
            `${p.nickname}, your account now uses ${p.newEmail}.`,
            "If you didn't make this change, reset your password and contact the other members of your family group.",
          ],
        })
      : render('Cambió el correo de tu cuenta de Our House', {
          heading: 'Tu correo cambió',
          paragraphs: [
            `${p.nickname}, tu cuenta ahora usa ${p.newEmail}.`,
            'Si no hiciste este cambio, restablece tu contraseña y avisa a los demás miembros de tu grupo familiar.',
          ],
        });
  },

  familyInvitation(locale: Locale, p: { inviter: string; family: string; url: string }): EmailContent {
    return locale === 'en'
      ? render(`${p.inviter} invited you to ${p.family}`, {
          heading: `Join ${p.family}`,
          paragraphs: [
            `${p.inviter} invited you to their family group on Our House. The invitation expires in 7 days.`,
            "If you don't have an account yet, sign up with this email and the invitation will be waiting for you.",
          ],
          action: { label: 'See invitation', url: p.url },
        })
      : render(`${p.inviter} te invitó a ${p.family}`, {
          heading: `Únete a ${p.family}`,
          paragraphs: [
            `${p.inviter} te invitó a su grupo familiar en Our House. La invitación vence en 7 días.`,
            'Si aún no tienes cuenta, regístrate con este correo y la invitación te estará esperando.',
          ],
          action: { label: 'Ver invitación', url: p.url },
        });
  },

  /** Una categoría llegó al 80 % o al 100 % de su presupuesto del mes */
  budgetAlert(
    locale: Locale,
    p: { category: string; pct: number; threshold: 80 | 100; spent: string; limit: string; month: string; family: string; url: string; settingsUrl: string },
  ): EmailContent {
    if (locale === 'en') {
      const over = p.threshold === 100;
      return render(`${p.category}: ${over ? 'budget used up' : `${p.pct}% of the budget`} in ${p.month}`, {
        heading: over ? `You reached the ${p.category} budget` : `${p.category} is at ${p.pct}% of its budget`,
        paragraphs: [
          `In ${p.family}, ${p.spent} of ${p.limit} has been spent on ${p.category} in ${p.month}.`,
          over ? 'From now on, every expense in this category goes over the budget.' : 'There is still room, but it is getting close.',
        ],
        action: { label: 'See summary', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    const over = p.threshold === 100;
    return render(`${p.category}: ${over ? 'se acabó el presupuesto' : `${p.pct} % del presupuesto`} de ${p.month}`, {
      heading: over ? `Llegaron al presupuesto de ${p.category}` : `${p.category} va en ${p.pct} % del presupuesto`,
      paragraphs: [
        `En ${p.family} se llevan ${p.spent} de ${p.limit} en ${p.category} durante ${p.month}.`,
        over ? 'Desde ahora, cada gasto en esta categoría queda por encima del presupuesto.' : 'Todavía queda margen, pero ya está cerca.',
      ],
      action: { label: 'Ver resumen', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },

  /** Un proyecto de ahorro llegó a su meta */
  savingsGoal(locale: Locale, p: { project: string; saved: string; goal: string; family: string; url: string; settingsUrl: string }): EmailContent {
    if (locale === 'en') {
      return render(`🎯 “${p.project}” reached its goal`, {
        heading: `Goal reached: ${p.project}`,
        paragraphs: [`In ${p.family}, ${p.saved} has been set aside for “${p.project}” (goal: ${p.goal}).`, 'You can keep saving or close the project to release the money.'],
        action: { label: 'See savings', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    return render(`🎯 «${p.project}» llegó a la meta`, {
      heading: `Meta cumplida: ${p.project}`,
      paragraphs: [`En ${p.family} ya hay ${p.saved} apartados para «${p.project}» (meta: ${p.goal}).`, 'Puedes seguir ahorrando o cerrar el proyecto para liberar el dinero.'],
      action: { label: 'Ver ahorros', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },

  /** El disponible de una cuenta (saldo menos ahorro) bajó del umbral */
  lowBalance(locale: Locale, p: { account: string; available: string; threshold: string; saved: string | null; url: string; settingsUrl: string }): EmailContent {
    if (locale === 'en') {
      return render(`${p.account}: available balance below ${p.threshold}`, {
        heading: `${p.account} is running low`,
        paragraphs: [
          `The available balance of ${p.account} is ${p.available}, below the ${p.threshold} you set.`,
          ...(p.saved ? [`It does not count the ${p.saved} set aside for savings.`] : []),
        ],
        action: { label: 'Open account', url: p.url },
        footnote: settingsNote(locale, p.settingsUrl),
      });
    }
    return render(`${p.account}: el disponible bajó de ${p.threshold}`, {
      heading: `A ${p.account} le queda poco`,
      paragraphs: [
        `El disponible de ${p.account} es ${p.available}, por debajo de los ${p.threshold} que definiste.`,
        ...(p.saved ? [`No cuenta los ${p.saved} apartados para ahorros.`] : []),
      ],
      action: { label: 'Abrir cuenta', url: p.url },
      footnote: settingsNote(locale, p.settingsUrl),
    });
  },
};
