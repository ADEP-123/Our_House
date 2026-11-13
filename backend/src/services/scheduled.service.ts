import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/http-error.js';
import { mailer } from '../lib/mailer.js';
import { addDays, finished, nextDate, todayIn, type RepeatRule } from '../lib/recurrence.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { categoriesRepository } from '../repositories/categories.repository.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { savingsRepository } from '../repositories/savings.repository.js';
import {
  scheduledRepository,
  type DueRow,
  type PauseReason,
  type ScheduledKind,
  type ScheduledRow,
  type ScheduledViewRow,
} from '../repositories/scheduled.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { computeAccess, getAccountAccess } from './accounts.service.js';
import { requireMember } from './families.service.js';
import { movementsService, transfersService } from './movements.service.js';
import { savingsService } from './savings.service.js';

export interface ScheduledBody {
  id?: string;
  accountId: string;
  kind: ScheduledKind;
  toAccountId?: string | null;
  savingsProjectId?: string | null;
  categoryId?: string | null;
  amount: number;
  description: string;
  mode: 'auto' | 'confirm';
  rule: Omit<RepeatRule, 'from'>;
  remindDays?: number | null;
  notifyDone?: boolean;
}

/** Como mucho, cuántas veces se pone al día un programado en una pasada (ej. tras semanas sin proceso) */
const MAX_CATCH_UP = 24;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fullRule = (rule: Omit<RepeatRule, 'from'>): RepeatRule => ({ ...rule, from: 'schedule' });

/** Primera fecha de la regla que es hoy o después (null si ya terminó) */
function firstFrom(rule: RepeatRule, today: string, timesDone: number): string | null {
  const next = rule.start >= today ? rule.start : nextDate(rule, addDays(today, -1));
  return finished(rule, next, timesDone) ? null : next;
}

async function userToday(userId: string): Promise<string> {
  return todayIn((await usersRepository.findById(userId))?.timezone ?? 'UTC');
}

/** Errores al registrar: algunos pausan el programado (hay que revisarlo), otros solo fallan esa vez */
function classify(err: unknown): { pause: PauseReason | null; code: string } {
  const code = err instanceof HttpError ? err.code : 'INTERNAL';
  if (code === 'ACCOUNT_ARCHIVED') return { pause: 'archived', code };
  if (['ACCOUNT_READ_ONLY', 'TRANSFER_READ_ONLY', 'FORBIDDEN', 'SAVINGS_MANAGE_ONLY'].includes(code)) return { pause: 'permission', code };
  if (['ACCOUNT_NOT_FOUND', 'CATEGORY_NOT_FOUND', 'CATEGORY_DISABLED', 'SAVINGS_NOT_FOUND', 'SAVINGS_CLOSED', 'FAMILY_NOT_FOUND', 'SAVINGS_CREDIT_ACCOUNT'].includes(code))
    return { pause: 'missing', code };
  if (!(err instanceof HttpError)) throw err; // error inesperado: que se vea
  return { pause: null, code };
}

/**
 * Registra una vez el programado (como quien lo creó, o quien confirma) con la fecha y el monto dados.
 * Usa los mismos servicios que la app: mismos permisos, validaciones y avisos.
 * @returns ids de los movimientos creados (vacío al apartar ahorro)
 */
async function register(s: ScheduledRow, date: string, amount: number, userId: string): Promise<string[]> {
  if (s.kind === 'in' || s.kind === 'out') {
    // La categoría se borró (queda en null): hay que revisar el programado
    if (!s.category_id) throw badRequest('CATEGORY_NOT_FOUND');
    const id = randomUUID();
    await movementsService.create(s.account_id, userId, {
      id,
      kind: s.kind,
      amount,
      date,
      description: s.description,
      categoryId: s.category_id,
    });
    return [id];
  }
  if (s.kind === 'transfer') {
    const ids = { id: randomUUID(), outId: randomUUID(), inId: randomUUID() };
    await transfersService.create(userId, { ...ids, fromAccountId: s.account_id, toAccountId: s.to_account_id!, amount, date, description: s.description });
    return [ids.outId, ids.inId];
  }
  await savingsService.move(s.savings_project_id!, userId, { accountId: s.account_id, action: 'set_aside', amount });
  return [];
}

const money = (n: number, currency: string, locale: Locale) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-ES', { style: 'currency', currency }).format(n);
const longDate = (date: string, locale: Locale) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const settingsUrl = () => `${env.appUrl}/perfil#notificaciones`;
const listUrl = () => `${env.appUrl}/finanzas/programados`;

const PROBLEMS: Record<Locale, Record<string, string>> = {
  es: {
    archived: 'La cuenta está archivada, así que se pausó. Reanúdalo cuando la restaures.',
    permission: 'Ya no tienes permiso para editar la cuenta, así que se pausó.',
    missing: 'La cuenta, la categoría o el proyecto ya no está disponible, así que se pausó. Revísalo y reanúdalo.',
    SAVINGS_NOT_ENOUGH: 'No alcanzó el disponible de la cuenta para apartarlo esta vez. Vuelve a intentarlo el próximo mes.',
  },
  en: {
    archived: 'The account is archived, so it was paused. Resume it when you restore the account.',
    permission: 'You can no longer edit the account, so it was paused.',
    missing: 'The account, category or project is no longer available, so it was paused. Check it and resume it.',
    SAVINGS_NOT_ENOUGH: 'The account did not have enough available to set it aside this time. It will try again next time.',
  },
};

/** Aviso en el correo si la cuenta quedó en negativo o la tarjeta pasó el cupo */
async function balanceWarning(s: DueRow, userId: string): Promise<string | null> {
  if (s.kind === 'in' || s.kind === 'set_aside') return null;
  const a = await accountsRepository.find(s.account_id, userId);
  if (!a) return null;
  const locale = s.locale;
  if (a.kind === 'credit') {
    const over = r2(-a.balance - (a.credit_limit ?? 0));
    if (over <= 0) return null;
    return locale === 'en'
      ? `The card is over its limit by ${money(over, s.currency, locale)}.`
      : `La tarjeta pasó el cupo por ${money(over, s.currency, locale)}.`;
  }
  if (a.balance >= 0) return null;
  return locale === 'en'
    ? `The account is now negative: ${money(a.balance, s.currency, locale)}.`
    : `La cuenta quedó en negativo: ${money(a.balance, s.currency, locale)}.`;
}

/** Pone al día un programado: registra (o deja pendiente) cada fecha que ya tocó */
async function processDue(s: DueRow, today: string): Promise<void> {
  let next = s.next_date;
  let times = s.times_done;
  const what = s.description;
  const send = (content: ReturnType<typeof emailTemplates.scheduledDone>) =>
    s.can_email && s.email ? mailer.send(s.email, content).catch((err) => console.error('[programados] correo', err)) : Promise.resolve();

  for (let i = 0; next && next <= today && i < MAX_CATCH_UP; i++) {
    const due = next;
    const claimed = await scheduledRepository.addOccurrence({
      scheduleId: s.id,
      dueDate: due,
      status: s.mode === 'confirm' ? 'pending' : 'done',
      amount: s.amount,
    });
    if (claimed && s.mode === 'confirm') {
      await send(
        emailTemplates.scheduledPending(s.locale, { what, amount: money(s.amount, s.currency, s.locale), account: s.account_name, date: longDate(due, s.locale), url: listUrl(), settingsUrl: settingsUrl() }),
      );
    } else if (claimed) {
      try {
        if (!s.created_by) throw forbidden('FORBIDDEN');
        const ids = await register(s, due, s.amount, s.created_by);
        if (ids.length) await scheduledRepository.linkMovements(ids, s.id);
        await scheduledRepository.setOccurrence(s.id, due, 'done', ids[0] ?? null);
        if (s.notify_done) {
          await send(
            emailTemplates.scheduledDone(s.locale, {
              what,
              amount: money(s.amount, s.currency, s.locale),
              account: s.to_account_name ? `${s.account_name} → ${s.to_account_name}` : s.account_name,
              date: longDate(due, s.locale),
              warning: await balanceWarning(s, s.created_by),
              url: `${env.appUrl}/finanzas?cuenta=${s.account_id}`,
              settingsUrl: settingsUrl(),
            }),
          );
        }
      } catch (err) {
        const { pause, code } = classify(err);
        if (pause) {
          // Se pausa sin avanzar: la fecha queda libre para cuando se reanude
          await scheduledRepository.deleteOccurrence(s.id, due);
          await scheduledRepository.setPaused(s.id, pause);
          await send(emailTemplates.scheduledProblem(s.locale, { what, reason: PROBLEMS[s.locale][pause]!, url: listUrl(), settingsUrl: settingsUrl() }));
          return;
        }
        await scheduledRepository.setOccurrence(s.id, due, 'failed', null);
        await send(
          emailTemplates.scheduledProblem(s.locale, { what, reason: PROBLEMS[s.locale][code] ?? code, url: listUrl(), settingsUrl: settingsUrl() }),
        );
      }
    }
    // Una fecha ya resuelta en otra pasada (o saltada) no cuenta otra vez
    if (claimed) times++;
    next = nextDate(s.rule, due);
    if (finished(s.rule, next, times)) next = null;
    await scheduledRepository.advance(s.id, next, times);
  }
}

/** Aviso X días antes (una vez por fecha) */
async function remind(s: DueRow, today: string): Promise<void> {
  if (!s.remind_days || !s.next_date || s.next_date <= today || s.last_reminded_for === s.next_date) return;
  if (addDays(s.next_date, -s.remind_days) > today) return;
  await scheduledRepository.markReminded(s.id, s.next_date);
  if (!s.can_email || !s.email) return;
  const daysLeft = Math.round((Date.parse(s.next_date) - Date.parse(today)) / 86_400_000);
  await mailer.send(
    s.email,
    emailTemplates.scheduledReminder(s.locale, {
      what: s.description,
      amount: money(s.amount, s.currency, s.locale),
      account: s.to_account_name ? `${s.account_name} → ${s.to_account_name}` : s.account_name,
      date: longDate(s.next_date, s.locale),
      daysLeft,
      url: listUrl(),
      settingsUrl: settingsUrl(),
    }),
  );
}

/** Quién puede ver y quién puede cambiar cada programado (según sus cuentas) */
async function accessMap(familyId: string, userId: string) {
  const role = await requireMember(familyId, userId);
  const accounts = [
    ...(await accountsRepository.listForFamily(familyId, userId, false)),
    ...(await accountsRepository.listForFamily(familyId, userId, true)),
  ];
  const map = new Map(accounts.map((a) => [a.id, computeAccess(a, role, userId)]));
  return {
    role,
    canView: (s: ScheduledRow) => !!map.get(s.account_id)?.canView,
    canManage: (s: ScheduledRow) => !!map.get(s.account_id)?.canEdit && (!s.to_account_id || !!map.get(s.to_account_id)?.canEdit),
    visible: (id: string | null) => !!id && !!map.get(id)?.canView,
  };
}

function view(s: ScheduledViewRow, access: Awaited<ReturnType<typeof accessMap>>) {
  return {
    id: s.id,
    kind: s.kind,
    account: { id: s.account_id, name: s.account_name },
    toAccount: s.to_account_id ? { id: s.to_account_id, name: access.visible(s.to_account_id) ? s.to_account_name : null } : null,
    category: s.category_id ? { id: s.category_id, name: s.category_name, icon: s.category_icon, color: s.category_color } : null,
    project: s.savings_project_id ? { id: s.savings_project_id, name: s.project_name, icon: s.project_icon } : null,
    amount: r2(s.amount),
    description: s.description,
    mode: s.mode,
    rule: { freq: s.rule.freq, interval: s.rule.interval, weekdays: s.rule.weekdays, start: s.rule.start, until: s.rule.until ?? null, count: s.rule.count ?? null },
    nextDate: s.next_date,
    timesDone: s.times_done,
    remindDays: s.remind_days,
    notifyDone: s.notify_done,
    paused: s.paused_at ? { reason: s.pause_reason } : null,
    ended: !!s.ended_at,
    canManage: access.canManage(s),
    createdBy: s.created_by ? { id: s.created_by, nickname: s.created_by_nickname } : null,
  };
}

async function manageable(id: string, userId: string) {
  const s = await scheduledRepository.find(id);
  if (!s) throw notFound('SCHEDULED_NOT_FOUND');
  const access = await accessMap(s.family_id, userId).catch(() => {
    throw notFound('SCHEDULED_NOT_FOUND');
  });
  if (!access.canView(s)) throw notFound('SCHEDULED_NOT_FOUND');
  if (!access.canManage(s)) throw forbidden('SCHEDULED_READ_ONLY');
  return s;
}

/** Valida el programado y lo deja listo para guardar */
async function prepare(familyId: string, userId: string, body: ScheduledBody, id: string, timesDone: number) {
  const account = await getAccountAccess(body.accountId, userId);
  if (account.account.family_id !== familyId) throw badRequest('SCHEDULED_ACCOUNT_INVALID');
  if (!account.canEdit) throw forbidden(account.account.archived_at ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY');

  let categoryId: string | null = null;
  let toAccountId: string | null = null;
  let savingsProjectId: string | null = null;
  if (body.kind === 'in' || body.kind === 'out') {
    if (!body.categoryId) throw badRequest('CATEGORY_REQUIRED');
    const category = await categoriesRepository.find(body.categoryId);
    if (!category || category.family_id !== familyId) throw badRequest('CATEGORY_NOT_FOUND');
    categoryId = category.id;
  } else if (body.kind === 'transfer') {
    if (!body.toAccountId) throw badRequest('TRANSFER_ACCOUNT_REQUIRED');
    if (body.toAccountId === body.accountId) throw badRequest('TRANSFER_SAME_ACCOUNT');
    const to = await getAccountAccess(body.toAccountId, userId);
    if (to.account.family_id !== familyId) throw badRequest('TRANSFER_OTHER_FAMILY');
    if (!to.canEdit) throw forbidden(to.account.archived_at ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY');
    toAccountId = to.account.id;
  } else {
    if (account.account.kind === 'credit') throw badRequest('SAVINGS_CREDIT_ACCOUNT');
    const project = body.savingsProjectId ? await savingsRepository.find(body.savingsProjectId) : null;
    if (!project || project.family_id !== familyId) throw badRequest('SAVINGS_NOT_FOUND');
    if (project.closed_at) throw badRequest('SAVINGS_CLOSED');
    savingsProjectId = project.id;
  }
  const rule = fullRule(body.rule);
  if (rule.until && rule.until < rule.start) throw badRequest('SCHEDULED_UNTIL_INVALID');
  // Se registra desde la fecha de inicio aunque ya pasó (así se puede "registrar también el de este mes")
  const nextDateValue = finished(rule, rule.start, timesDone) ? null : rule.start;
  return {
    id,
    familyId,
    accountId: body.accountId,
    kind: body.kind,
    toAccountId,
    savingsProjectId,
    categoryId,
    amount: r2(body.amount),
    description: body.description,
    mode: body.mode,
    rule,
    nextDate: nextDateValue,
    remindDays: body.remindDays ?? null,
    notifyDone: body.notifyDone ?? true,
  };
}

/** Pone al día un programado recién creado o reanudado (con la fecha de hoy de quien lo creó) */
async function catchUp(id: string): Promise<void> {
  const s = await scheduledRepository.find(id);
  if (!s?.created_by || !s.next_date || s.paused_at || s.ended_at) return;
  const user = await usersRepository.findById(s.created_by);
  const family = await familiesRepository.findById(s.family_id);
  if (!user) return;
  const today = todayIn(user.timezone ?? 'UTC');
  if (s.next_date > today) return;
  await processDue(
    {
      ...s,
      timezone: user.timezone,
      locale: (user.locale as Locale) ?? 'es',
      email: user.email,
      can_email: user.email_scheduled && !!user.email_verified_at,
      currency: family?.currency ?? 'USD',
    },
    today,
  );
}

export const scheduledService = {
  /** Programados de las cuentas que la persona ve y lo que está pendiente de confirmar */
  async list(familyId: string, userId: string) {
    const access = await accessMap(familyId, userId);
    const [rows, pending, family] = await Promise.all([
      scheduledRepository.listForFamily(familyId),
      scheduledRepository.pending(familyId),
      familiesRepository.findById(familyId),
    ]);
    const visible = rows.filter((s) => access.canView(s));
    const byId = new Map(visible.map((s) => [s.id, s]));
    return {
      currency: family?.currency ?? 'USD',
      items: visible.map((s) => view(s, access)),
      pending: pending
        .filter((o) => byId.has(o.schedule_id))
        .map((o) => ({ id: o.id, scheduleId: o.schedule_id, dueDate: o.due_date, amount: o.amount === null ? null : r2(o.amount) })),
    };
  },

  async create(familyId: string, userId: string, body: ScheduledBody) {
    await requireMember(familyId, userId);
    const id = body.id ?? randomUUID();
    const input = await prepare(familyId, userId, body, id, 0);
    if (await scheduledRepository.create(input, userId)) await catchUp(id);
    return { id };
  },

  async update(id: string, userId: string, body: ScheduledBody) {
    const current = await manageable(id, userId);
    const input = await prepare(current.family_id, userId, body, id, current.times_done);
    // Al cambiar la regla, la próxima fecha es la primera desde hoy (lo pasado ya se registró o se saltó)
    input.nextDate = firstFrom(input.rule, await userToday(userId), current.times_done);
    await scheduledRepository.update(input);
    return { id };
  },

  async remove(id: string, userId: string) {
    await manageable(id, userId);
    await scheduledRepository.delete(id);
  },

  async pause(id: string, userId: string) {
    await manageable(id, userId);
    await scheduledRepository.setPaused(id, 'manual');
    return { id };
  },

  /** Reanudar: sigue desde hoy (lo que tocó mientras estaba pausado no se registra); nunca vuelve atrás */
  async resume(id: string, userId: string) {
    const s = await manageable(id, userId);
    const today = await userToday(userId);
    const next = s.next_date && s.next_date >= today ? s.next_date : firstFrom(s.rule, today, s.times_done);
    await scheduledRepository.setPaused(id, null, next);
    await catchUp(id);
    return { id };
  },

  /** Saltar la próxima vez (ej. no hay clases en diciembre) */
  async skip(id: string, userId: string) {
    const s = await manageable(id, userId);
    if (!s.next_date || s.ended_at) throw badRequest('SCHEDULED_ENDED');
    await scheduledRepository.addOccurrence({ scheduleId: id, dueDate: s.next_date, status: 'skipped', amount: null, userId });
    const next = nextDate(s.rule, s.next_date);
    await scheduledRepository.advance(id, finished(s.rule, next, s.times_done) ? null : next, s.times_done);
    return { id };
  },

  /** Confirmar un pendiente con el monto real (y la fecha, si fue otro día) */
  async confirm(occurrenceId: string, userId: string, input: { amount: number; date?: string }) {
    const o = await scheduledRepository.findOccurrence(occurrenceId);
    if (!o || o.status !== 'pending') throw notFound('SCHEDULED_PENDING_NOT_FOUND');
    const s = await manageable(o.schedule_id, userId);
    const ids = await register(s, input.date ?? o.due_date, r2(input.amount), userId);
    if (ids.length) await scheduledRepository.linkMovements(ids, s.id);
    await scheduledRepository.resolveOccurrence(occurrenceId, 'done', r2(input.amount), ids[0] ?? null, userId);
    return { id: occurrenceId, movementIds: ids };
  },

  /** Descartar un pendiente (esta vez no se cobró) */
  async dismiss(occurrenceId: string, userId: string) {
    const o = await scheduledRepository.findOccurrence(occurrenceId);
    if (!o || o.status !== 'pending') throw notFound('SCHEDULED_PENDING_NOT_FOUND');
    await manageable(o.schedule_id, userId);
    await scheduledRepository.resolveOccurrence(occurrenceId, 'skipped', null, null, userId);
    return { id: occurrenceId };
  },

  /** Próximas fechas de los programados activos hasta `to` (para "próximos cobros" y el saldo proyectado) */
  async upcoming(familyId: string, userId: string, to: string) {
    const access = await accessMap(familyId, userId);
    const rows = (await scheduledRepository.listForFamily(familyId)).filter((s) => access.canView(s) && !s.paused_at && !s.ended_at && s.next_date);
    const list = [];
    for (const s of rows) {
      let date = s.next_date!;
      let times = s.times_done;
      for (let i = 0; date <= to && i < 62; i++) {
        list.push({
          scheduleId: s.id,
          date,
          kind: s.kind,
          amount: r2(s.amount),
          description: s.description,
          mode: s.mode,
          accountId: s.account_id,
          accountName: s.account_name,
          toAccountId: s.to_account_id,
          toAccountName: access.visible(s.to_account_id) ? s.to_account_name : null,
        });
        times++;
        const next = nextDate(s.rule, date);
        if (finished(s.rule, next, times)) break;
        date = next;
      }
    }
    return { to, items: list.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description)) };
  },

  /** Gastos que se repiten cada mes y todavía no están programados */
  async suggestions(familyId: string, userId: string) {
    const access = await accessMap(familyId, userId);
    const accounts = [
      ...(await accountsRepository.listForFamily(familyId, userId, false)),
    ].filter((a) => access.visible(a.id));
    if (!accounts.length) return { suggestions: [] };
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const since = addDays(await userToday(userId), -183);
    const rows = await scheduledRepository.suggestions([...names.keys()], since);
    return {
      suggestions: rows.map((r) => ({
        accountId: r.account_id,
        accountName: names.get(r.account_id)!,
        description: r.description,
        categoryId: r.category_id,
        amount: r2(r.amount),
        day: r.day,
        months: r.months,
      })),
    };
  },

  /** Proceso horario: avisos previos y registro de lo que ya tocó (cada uno con la fecha de hoy de quien lo creó) */
  async run(now = new Date()) {
    const rows = await scheduledRepository.active(todayIn('Pacific/Kiritimati', now));
    let processed = 0;
    for (const s of rows) {
      const today = todayIn(s.timezone || 'UTC', now);
      try {
        await remind(s, today);
        if (s.next_date && s.next_date <= today) {
          await processDue(s, today);
          processed++;
        }
      } catch (err) {
        console.error('[programados]', s.id, err);
      }
    }
    return { scheduled: processed };
  },
};
