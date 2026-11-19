import { randomUUID } from 'node:crypto';
import { db, withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { cardMonths, debtBalance, installmentInfo, lastMonths, paidOf, type DebtEntryKind } from '../lib/debts.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/http-error.js';
import { mailer } from '../lib/mailer.js';
import { todayIn } from '../lib/recurrence.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { debtsRepository, type DebtDirection, type DebtEntryRow, type DebtRow, type DebtViewMode } from '../repositories/debts.repository.js';
import { familiesRepository, type FamilyRole } from '../repositories/families.repository.js';
import { computeAccess } from './accounts.service.js';
import { requireMember } from './families.service.js';
import { movementsService } from './movements.service.js';
import { shouldRemind } from './reminders.service.js';

/**
 * Quién puede hacer qué con una deuda (las mismas reglas que las cuentas):
 * - Ver: todo el grupo, las personas elegidas o solo quien la creó (privada).
 *   Un líder ve las privadas de un supervisado, solo para leer.
 * - Administrar (editar sus datos, borrarla): quien la creó; si salió del grupo, los líderes.
 * - Registrar abonos y cambios de monto: quien administra, o quien la ve y es líder o miembro.
 */
export function debtAccess(d: DebtRow, role: FamilyRole, userId: string) {
  const canAdmin = d.owner_id === userId || (d.owner_id === null && role === 'leader');
  const canView = canAdmin || d.view_mode === 'family' || (d.view_mode === 'members' && d.viewer_ids.includes(userId));
  const canEdit = canView && (canAdmin || (d.view_mode !== 'private' && (role === 'leader' || role === 'member')));
  const supervision = !canView && d.view_mode === 'private' && role === 'leader' && d.owner_role === 'supervised';
  return { canView: canView || supervision, canEdit, canAdmin, supervision };
}

async function access(id: string, userId: string) {
  const debt = await debtsRepository.find(id);
  if (!debt) throw notFound('DEBT_NOT_FOUND');
  const role = await familiesRepository.getRole(debt.family_id, userId);
  if (!role) throw notFound('DEBT_NOT_FOUND');
  const a = debtAccess(debt, role, userId);
  if (!a.canView) throw notFound('DEBT_NOT_FOUND');
  return { debt, role, ...a };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function timezoneOf(userId: string): Promise<string> {
  const { rows } = await db().query<{ timezone: string }>('SELECT timezone FROM users WHERE id = $1', [userId]);
  return rows[0]?.timezone ?? 'UTC';
}

/** Día en que se creó, en la zona horaria de quien mira (en UTC puede ser ya el día siguiente) */
const createdOn = (d: DebtRow, timeZone: string) => todayIn(timeZone, d.created_at);

function toDebtView(d: DebtRow, entries: DebtEntryRow[], perms: ReturnType<typeof debtAccess>) {
  const mine = entries.filter((e) => e.debt_id === d.id);
  const balance = debtBalance(d.amount, mine);
  const paid = paidOf(mine);
  return {
    id: d.id,
    familyId: d.family_id,
    direction: d.direction,
    title: d.title,
    description: d.description,
    counterparty: d.counterparty,
    amount: d.amount,
    balance,
    paid,
    /** Lo que se llegó a deber: monto inicial + aumentos − disminuciones */
    total: r2(d.amount + mine.reduce((s, e) => s + (e.kind === 'increase' ? e.amount : e.kind === 'decrease' ? -e.amount : 0), 0)),
    dueDate: d.due_date,
    installments: installmentInfo(d.amount, d.installments, paid),
    interest: d.interest_rate !== null ? { rate: d.interest_rate, period: d.interest_period } : null,
    viewMode: d.view_mode,
    viewers: d.viewer_ids,
    owner: d.owner_id ? { id: d.owner_id, nickname: d.owner_nickname } : null,
    createdAt: d.created_at,
    lastEntryAt: mine.at(-1)?.date ?? null,
    permissions: { canEdit: perms.canEdit && !perms.supervision, canAdmin: perms.canAdmin && !perms.supervision, supervision: perms.supervision },
  };
}

const code = (prefix: string | null, n: number | null) => (prefix && n ? `${prefix}${String(n).padStart(4, '0')}` : null);

export interface DebtInput {
  id?: string;
  direction: DebtDirection;
  title: string;
  description?: string | null;
  counterparty: string;
  amount: number;
  dueDate?: string | null;
  installments?: number | null;
  interestRate?: number | null;
  interestPeriod?: 'monthly' | 'annual' | null;
  viewMode: DebtViewMode;
  viewers: string[];
}

async function prepare(familyId: string, ownerId: string | null, input: DebtInput) {
  const members = new Set((await familiesRepository.listMembers(familyId)).map((m) => m.user_id));
  if (input.viewers.some((id) => !members.has(id))) throw badRequest('DEBT_MEMBER_INVALID');
  const rate = input.interestRate ?? null;
  return {
    fields: {
      direction: input.direction,
      title: input.title,
      description: input.description ?? null,
      counterparty: input.counterparty,
      amount: input.amount,
      dueDate: input.dueDate ?? null,
      installments: input.installments ?? null,
      interestRate: rate,
      interestPeriod: rate === null ? null : (input.interestPeriod ?? 'monthly'),
      viewMode: input.viewMode,
    },
    viewers: input.viewMode === 'members' ? [...new Set(input.viewers)].filter((id) => id !== ownerId) : [],
  };
}

export interface EntryInput {
  id?: string;
  kind: DebtEntryKind;
  amount: number;
  date: string;
  note?: string | null;
  /** Abono: registrar también el movimiento en esta cuenta (salida si debo, entrada si me deben) */
  accountId?: string | null;
  categoryId?: string | null;
}

export const debtsService = {
  /** Deudas que la persona ve, las tarjetas de crédito, los totales y la deuda de cada mes */
  async list(familyId: string, userId: string) {
    const role = await requireMember(familyId, userId);
    const family = await familiesRepository.findById(familyId);
    const timeZone = await timezoneOf(userId);
    const today = todayIn(timeZone);
    const months = lastMonths(today);

    const visible = (await debtsRepository.listForFamily(familyId)).map((d) => ({ d, a: debtAccess(d, role, userId) })).filter((x) => x.a.canView);
    const entries = await debtsRepository.entries(visible.map((x) => x.d.id));
    const debts = visible.map(({ d, a }) => toDebtView(d, entries, a));

    // Tarjetas de crédito activas que la persona ve normalmente (su deuda sale del saldo)
    const accounts = (await accountsRepository.listForFamily(familyId, userId, false)).filter(
      (a) => a.kind === 'credit' && computeAccess(a, role, userId).canView,
    );
    const { rows: cardMoves } = await db().query<{ account_id: string; date: string; kind: string; amount: number }>(
      `SELECT account_id, to_char(date, 'YYYY-MM-DD') AS date, kind, amount::float8 AS amount
         FROM account_movements WHERE account_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [accounts.map((a) => a.id)],
    );
    const cards = accounts.map((a) => {
      const moves = cardMoves.filter((m) => m.account_id === a.id);
      const monthly = cardMonths(moves, months);
      return {
        id: a.id,
        name: a.name,
        debt: monthly.at(-1)!.debt,
        limit: a.credit_limit ?? 0,
        paymentDay: a.payment_day,
        months: monthly,
      };
    });

    // Deuda de cada mes (al cierre): las deudas desde que se crearon y, en "Debo", las tarjetas
    const timeline = months.map(({ month, end }, i) => {
      const at = (dir: DebtDirection) =>
        visible
          .filter(({ d }) => d.direction === dir && createdOn(d, timeZone) <= end)
          .reduce((s, { d }) => s + debtBalance(d.amount, entries.filter((e) => e.debt_id === d.id), end), 0);
      return { month, owe: r2(at('owe') + cards.reduce((s, c) => s + c.months[i]!.debt, 0)), owed: r2(at('owed')) };
    });

    const sum = (dir: DebtDirection) => r2(debts.filter((d) => d.direction === dir).reduce((s, d) => s + d.balance, 0));
    const cardsDebt = r2(cards.reduce((s, c) => s + c.debt, 0));
    return {
      currency: family?.currency ?? 'USD',
      today,
      debts,
      cards,
      totals: { owe: sum('owe'), owed: sum('owed'), cards: cardsDebt },
      timeline,
    };
  },

  async create(familyId: string, userId: string, input: DebtInput) {
    await requireMember(familyId, userId);
    const id = input.id ?? randomUUID();
    const { fields, viewers } = await prepare(familyId, userId, input);
    await withTransaction(async (conn) => {
      if (!(await debtsRepository.create(id, familyId, userId, fields, conn))) return; // reenvío
      await debtsRepository.setViewers(id, viewers, conn);
    });
    return { id };
  },

  async update(id: string, userId: string, input: DebtInput) {
    const a = await access(id, userId);
    if (!a.canAdmin || a.supervision) throw forbidden('DEBT_ADMIN_ONLY');
    const { fields, viewers } = await prepare(a.debt.family_id, a.debt.owner_id, input);
    await withTransaction(async (conn) => {
      await debtsRepository.update(id, fields, conn);
      await debtsRepository.setViewers(id, viewers, conn);
    });
    return { id };
  },

  async remove(id: string, userId: string) {
    const a = await access(id, userId);
    if (!a.canAdmin || a.supervision) throw forbidden('DEBT_ADMIN_ONLY');
    // Los movimientos de los abonos quedan en sus cuentas: ya ocurrieron
    await debtsRepository.delete(id);
  },

  /** Historial: abonos (con su movimiento) y cambios de monto, del más nuevo al más viejo, y la creación */
  async history(id: string, userId: string) {
    const { debt } = await access(id, userId);
    const entries = await debtsRepository.entries([id]);
    // Abonos y cambios del más nuevo al más viejo; al final, la creación (aunque se anote algo con fecha anterior)
    const sorted = [...entries].sort((x, y) => (y.date === x.date ? +y.created_at - +x.created_at : y.date.localeCompare(x.date)));
    return [
      ...sorted.map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: e.amount,
        date: e.date,
        note: e.note,
        by: e.created_by ? { id: e.created_by, nickname: e.created_by_nickname } : null,
        createdAt: e.created_at,
        movement:
          e.movement_id && !e.movement_deleted
            ? { id: e.movement_id, accountId: e.account_id, accountName: e.account_name, code: code(e.account_prefix, e.movement_number) }
            : null,
      })),
      {
        id: `${id}-created`,
        kind: 'created' as const,
        amount: debt.amount,
        date: createdOn(debt, await timezoneOf(userId)),
        note: null,
        by: debt.owner_id ? { id: debt.owner_id, nickname: debt.owner_nickname } : null,
        createdAt: debt.created_at,
        movement: null,
      },
    ];
  },

  /** Abono o cambio de monto. Un abono puede registrar también su movimiento en una cuenta. */
  async addEntry(debtId: string, userId: string, input: EntryInput) {
    const a = await access(debtId, userId);
    if (!a.canEdit || a.supervision) throw forbidden('DEBT_READ_ONLY');
    const entries = await debtsRepository.entries([debtId]);
    const id = input.id ?? randomUUID();
    if (entries.some((e) => e.id === id)) return { id }; // reenvío
    const balance = debtBalance(a.debt.amount, entries);
    if (input.kind !== 'increase' && input.amount > balance) throw badRequest('DEBT_AMOUNT_TOO_MUCH', { balance });

    let movementId: string | null = null;
    if (input.kind === 'payment' && input.accountId) {
      if (!input.categoryId) throw badRequest('CATEGORY_NOT_FOUND');
      const created = await movementsService.create(input.accountId, userId, {
        kind: a.debt.direction === 'owe' ? 'out' : 'in',
        amount: input.amount,
        date: input.date,
        description: `${a.debt.title} · ${a.debt.counterparty}`.slice(0, 200),
        categoryId: input.categoryId,
      });
      movementId = created.id;
    }
    try {
      await debtsRepository.addEntry({
        id,
        debtId,
        kind: input.kind,
        amount: input.amount,
        date: input.date,
        note: input.note ?? null,
        movementId,
        userId,
      });
    } catch (err) {
      if (movementId) await movementsService.remove(movementId, userId).catch(() => undefined);
      throw err;
    }
    return { id };
  },

  /** Quitar un abono o cambio; el movimiento del abono, si lo tiene, también se borra (se puede restaurar en la cuenta) */
  async removeEntry(entryId: string, userId: string) {
    const entry = await debtsRepository.findEntry(entryId);
    if (!entry) throw notFound('DEBT_ENTRY_NOT_FOUND');
    const a = await access(entry.debt_id, userId);
    if (!a.canEdit || a.supervision) throw forbidden('DEBT_READ_ONLY');
    if (entry.movement_id && !entry.movement_deleted) {
      await movementsService.remove(entry.movement_id, userId).catch((err) => {
        if (!(err instanceof HttpError && err.status === 404)) throw err;
      });
    }
    await debtsRepository.deleteEntry(entryId);
  },

  /**
   * Correo antes del vencimiento a quien la creó y a quienes la editan, con sus recordatorios de
   * tareas (desde X días antes, cada N días, a su hora) y los avisos de finanzas activados.
   * Para cuando la deuda queda en 0.
   */
  async run(now = new Date()): Promise<{ debtReminders: number }> {
    const { rows } = await db().query<{ id: string }>(
      `SELECT id FROM debts WHERE due_date BETWEEN (now() - interval '2 days')::date AND (now() + interval '62 days')::date`,
    );
    let sent = 0;
    for (const { id } of rows) {
      const debt = (await debtsRepository.find(id))!;
      const entries = await debtsRepository.entries([id]);
      const balance = debtBalance(debt.amount, entries);
      if (balance <= 0) continue;
      const members = await familiesRepository.listMembers(debt.family_id);
      const ids = members.filter((m) => {
        const x = debtAccess(debt, m.role, m.user_id);
        return x.canEdit && !x.supervision;
      });
      if (!ids.length) continue;
      const { rows: people } = await db().query<{
        id: string;
        email: string;
        locale: Locale;
        timezone: string;
        reminder_hour: number;
        start_days: number;
        every_days: number;
        currency: string;
      }>(
        `SELECT u.id, u.email, u.locale, u.timezone, u.reminder_hour, u.reminder_start_days AS start_days, u.reminder_every_days AS every_days,
                f.currency
           FROM users u JOIN families f ON f.id = $2
          WHERE u.id = ANY($1::uuid[]) AND u.email_finance AND u.email_verified_at IS NOT NULL`,
        [ids.map((m) => m.user_id), debt.family_id],
      );
      for (const p of people) {
        const when = shouldRemind({ due_date: debt.due_date!, due_at: null, start_days: p.start_days, every_days: p.every_days, timezone: p.timezone, reminder_hour: p.reminder_hour }, now);
        if (!when) continue;
        const claimed = await db().query('INSERT INTO debt_reminder_sends (debt_id, user_id, local_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
          id,
          p.id,
          when.localDate,
        ]);
        if (!claimed.rowCount) continue;
        const intl = p.locale === 'en' ? 'en-US' : 'es-ES';
        try {
          await mailer.send(
            p.email,
            emailTemplates.debtDue(p.locale, {
              direction: debt.direction,
              title: debt.title,
              counterparty: debt.counterparty,
              amount: new Intl.NumberFormat(intl, { style: 'currency', currency: p.currency }).format(balance),
              date: new Date(`${debt.due_date}T12:00:00Z`).toLocaleDateString(intl, { day: 'numeric', month: 'long', timeZone: 'UTC' }),
              daysLeft: when.daysLeft,
              url: `${env.appUrl}/finanzas/deudas?deuda=${id}`,
              settingsUrl: `${env.appUrl}/perfil#notificaciones`,
            }),
          );
          sent++;
        } catch (err) {
          await db().query('DELETE FROM debt_reminder_sends WHERE debt_id = $1 AND user_id = $2 AND local_date = $3', [id, p.id, when.localDate]);
          console.error('[deuda]', err);
        }
      }
    }
    return { debtReminders: sent };
  },
};
