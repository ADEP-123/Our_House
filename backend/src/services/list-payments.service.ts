import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../config/database.js';
import { badRequest, forbidden } from '../lib/http-error.js';
import { todayIn } from '../lib/recurrence.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { categoriesRepository } from '../repositories/categories.repository.js';
import { listPaymentsRepository } from '../repositories/list-payments.repository.js';
import { movementsRepository } from '../repositories/movements.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { computeAccess, getAccountAccess } from './accounts.service.js';
import { seedIfNeeded } from './categories.service.js';
import { financeAlerts } from './finance-alerts.service.js';
import { getAccess } from './lists.service.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const code = (prefix: string | null, n: number | null) => (prefix && n ? `${prefix}${String(n).padStart(4, '0')}` : null);

/** "Súper · 6 artículos" en el idioma de quien registra */
function description(list: string, count: number, locale: string): string {
  const what = locale === 'en' ? (count === 1 ? 'item' : 'items') : count === 1 ? 'artículo' : 'artículos';
  return `${list} · ${count} ${what}`.slice(0, 200);
}

async function shoppingAccess(listId: string, userId: string) {
  const access = await getAccess(listId, userId);
  if (!access.list.features.includes('purchases')) throw badRequest('PURCHASES_DISABLED');
  return access;
}

export interface RegisterInput {
  id?: string;
  /** null: "No registrar" (se da por pagado sin crear movimiento) */
  accountId: string | null;
  categoryId?: string | null;
  date?: string;
}

/**
 * Registrar pago (listas de compras): junta en un solo movimiento lo pagado en los artículos desde el último pago.
 * La lista recuerda la categoría y la última cuenta. Desmarcar un artículo pagado lo descuenta del movimiento
 * (si el pago queda en cero, el movimiento se borra); reiniciar la lista borra los movimientos de sus pagos.
 */
export const listPaymentsService = {
  /** Lo pendiente de registrar, las cuentas donde la persona puede registrarlo y los últimos pagos */
  async pending(listId: string, userId: string) {
    const access = await shoppingAccess(listId, userId);
    const familyId = access.list.family_id;
    await seedIfNeeded(familyId, userId);
    const [items, settings, recent, accounts, categories] = await Promise.all([
      listPaymentsRepository.pendingItems(listId),
      listPaymentsRepository.settings(listId),
      listPaymentsRepository.recent(listId),
      accountsRepository.listForFamily(familyId, userId, false),
      categoriesRepository.listForFamily(familyId),
    ]);
    const editable = accounts.filter((a) => computeAccess(a, access.role, userId).canEdit);
    const visible = new Set(accounts.filter((a) => computeAccess(a, access.role, userId).canView).map((a) => a.id));
    const links = await listPaymentsRepository.links(listId, null);
    return {
      currency: access.list.currency,
      canRegister: access.canCheck,
      total: r2(items.reduce((s, i) => s + i.amount, 0)),
      items: items.map((i) => ({ id: i.id, text: i.text, amount: r2(i.amount) })),
      accountId: editable.some((a) => a.id === settings.payment_account_id) ? settings.payment_account_id : null,
      categoryId: settings.payment_category_id,
      accounts: editable.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      categories: categories.filter((c) => !c.disabled_at).map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
      /** Artículos que están en un pago con movimiento (desmarcarlos lo descuenta) */
      paidItems: [...new Set(links.filter((l) => l.movement_id && !l.movement_deleted).map((l) => l.item_id))],
      recent: recent.map((p) => ({
        id: p.id,
        amount: r2(p.amount),
        items: p.items_count,
        registered: p.registered,
        account: p.account_id && visible.has(p.account_id) ? { id: p.account_id, name: p.account_name } : null,
        movementCode: p.account_id && visible.has(p.account_id) && !p.movement_deleted ? code(p.account_prefix, p.movement_number) : null,
        movementDeleted: !!p.movement_deleted || (p.registered && !p.movement_id),
        by: p.created_by ? { id: p.created_by, nickname: p.created_by_nickname } : null,
        at: p.created_at,
      })),
    };
  },

  async register(listId: string, userId: string, input: RegisterInput) {
    const access = await shoppingAccess(listId, userId);
    if (!access.canCheck) throw forbidden(access.list.archived_at ? 'LIST_ARCHIVED' : 'LIST_READ_ONLY');
    const paymentId = input.id ?? randomUUID();
    if (await listPaymentsRepository.find(paymentId)) return { id: paymentId }; // reenvío

    let account: Awaited<ReturnType<typeof getAccountAccess>> | null = null;
    let categoryId: string | null = null;
    if (input.accountId) {
      account = await getAccountAccess(input.accountId, userId);
      if (account.account.family_id !== access.list.family_id) throw badRequest('PAYMENT_ACCOUNT_INVALID');
      if (!account.canEdit) throw forbidden(account.account.archived_at ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY');
      categoryId = input.categoryId ?? (await listPaymentsRepository.settings(listId)).payment_category_id;
      if (!categoryId) throw badRequest('CATEGORY_REQUIRED');
      const category = await categoriesRepository.find(categoryId);
      if (!category || category.family_id !== access.list.family_id) throw badRequest('CATEGORY_NOT_FOUND');
      if (category.disabled_at) throw badRequest('CATEGORY_DISABLED');
    }
    const user = await usersRepository.findById(userId);
    const date = input.date ?? todayIn(user?.timezone ?? 'UTC');
    const movementId = account ? randomUUID() : null;

    const result = await withTransaction(async (conn) => {
      await listPaymentsRepository.lockList(listId, conn);
      const items = await listPaymentsRepository.pendingItems(listId, conn);
      const total = r2(items.reduce((s, i) => s + i.amount, 0));
      if (!items.length || total <= 0) throw badRequest('PAYMENT_NOTHING_PENDING');
      let number: number | null = null;
      if (account && movementId) {
        number = await accountsRepository.nextNumber(account.account.id, conn);
        await movementsRepository.create(
          {
            id: movementId,
            accountId: account.account.id,
            number,
            kind: 'out',
            amount: total,
            date,
            description: description(access.list.name, items.length, user?.locale ?? 'es'),
            categoryId,
            userId,
          },
          conn,
        );
        await movementsRepository.addHistory(movementId, userId, 'created', null, conn);
      }
      await listPaymentsRepository.create(
        { id: paymentId, listId, movementId, accountId: account?.account.id ?? null, amount: total, registered: !!account, userId },
        items,
        conn,
      );
      await listPaymentsRepository.remember(listId, account?.account.id ?? null, categoryId, conn);
      return { total, items: items.length, code: account ? code(account.account.prefix, number) : null };
    });
    if (account) financeAlerts.afterChange(access.list.family_id, [account.account.id], userId);
    return { id: paymentId, amount: result.total, items: result.items, movementCode: result.code };
  },

  /**
   * Se desmarcan artículos (o se reinicia la lista, itemIds null): lo que ya estaba en un pago con movimiento
   * se descuenta de ese movimiento; si el pago queda en cero, el movimiento se borra. Va en el historial del movimiento.
   * @returns cuántos movimientos cambiaron y cuántos se borraron (para el aviso)
   */
  async onItemsReset(listId: string, itemIds: string[] | null, userId: string, familyId: string) {
    const links = await listPaymentsRepository.links(listId, itemIds);
    if (!links.length) return { updated: 0, deleted: 0 };
    const byPayment = new Map<string, PendingLinks>();
    for (const l of links) {
      const entry = byPayment.get(l.payment_id) ?? { items: [], amount: 0, movementId: l.movement_id, movementAmount: l.movement_amount, movementDeleted: !!l.movement_deleted, accountId: l.account_id };
      entry.items.push(l.item_id);
      entry.amount = r2(entry.amount + l.amount);
      byPayment.set(l.payment_id, entry);
    }
    let updated = 0;
    let deleted = 0;
    const accounts = new Set<string>();
    await withTransaction(async (conn) => {
      for (const [paymentId, p] of byPayment) {
        await listPaymentsRepository.removeItems(paymentId, p.items, p.amount, conn);
        if (!p.movementId || p.movementDeleted || p.movementAmount === null) continue;
        const next = r2(p.movementAmount - p.amount);
        if (p.accountId) accounts.add(p.accountId);
        if (next <= 0) {
          await movementsRepository.setDeleted(p.movementId, true, userId, conn);
          await movementsRepository.addHistory(p.movementId, userId, 'deleted', { source: ['', 'list'] }, conn);
          deleted++;
        } else {
          await updateAmount(p.movementId, next, userId, conn);
          await movementsRepository.addHistory(p.movementId, userId, 'updated', { amount: [p.movementAmount, next] }, conn);
          updated++;
        }
      }
    });
    if (accounts.size) financeAlerts.afterChange(familyId, [...accounts], userId);
    return { updated, deleted };
  },
};

interface PendingLinks {
  items: string[];
  amount: number;
  movementId: string | null;
  movementAmount: number | null;
  movementDeleted: boolean;
  accountId: string | null;
}

async function updateAmount(movementId: string, amount: number, userId: string, conn: Db) {
  await conn.query('UPDATE account_movements SET amount = $2, updated_by = $3, updated_at = now() WHERE id = $1', [movementId, amount, userId]);
}
