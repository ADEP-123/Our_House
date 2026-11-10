import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/database.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/http-error.js';
import { categoriesRepository } from '../repositories/categories.repository.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { movementsRepository, type MovementKind, type MovementRow, type MovementViewRow } from '../repositories/movements.repository.js';
import { getAccountAccess, visibleAccountIds, type AccountAccess } from './accounts.service.js';
import { requireMember } from './families.service.js';

/** Columnas de la tabla de una cuenta que cada persona puede ocultar */
export const MOVEMENT_COLUMNS = ['code', 'date', 'description', 'category', 'amount', 'balance', 'createdBy'] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const signed = (m: Pick<MovementRow, 'kind' | 'amount'>) => (m.kind === 'out' || m.kind === 'transfer_out' ? -m.amount : m.amount);
const isTransfer = (m: Pick<MovementRow, 'transfer_id'>) => m.transfer_id !== null;
const code = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}`;

/**
 * @param visible cuentas que la persona ve: de la otra mitad de una transferencia
 * solo se muestra el nombre y el ID si también la ve
 */
function toMovementView(m: MovementViewRow, prefix: string, visible: Set<string>) {
  const seesOther = !!m.counterpart_account_id && visible.has(m.counterpart_account_id);
  return {
    id: m.id,
    code: code(prefix, m.number),
    number: m.number,
    kind: m.kind,
    amount: m.amount,
    /** Monto con signo (las salidas en negativo) */
    signedAmount: signed(m),
    date: m.date,
    description: m.description,
    category: m.category_id ? { id: m.category_id, name: m.category_name, icon: m.category_icon, color: m.category_color } : null,
    createdBy: m.created_by ? { id: m.created_by, nickname: m.created_by_nickname } : null,
    edited: m.edited,
    balance: round2(m.balance),
    createdAt: m.created_at,
    transfer: m.transfer_id
      ? {
          id: m.transfer_id,
          accountId: seesOther ? m.counterpart_account_id : null,
          accountName: seesOther ? m.counterpart_account_name : null,
          code: seesOther && m.counterpart_prefix ? code(m.counterpart_prefix, m.counterpart_number!) : null,
        }
      : null,
  };
}

function requireEdit(access: AccountAccess): void {
  if (access.canEdit) return;
  throw forbidden(access.account.archived_at ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY');
}

/** Movimiento y permisos de su cuenta. Si la persona no ve la cuenta, el movimiento "no existe". */
async function movementAccess(id: string, userId: string, opts: { includeDeleted?: boolean; supervision?: boolean } = {}) {
  const movement = await movementsRepository.find(id);
  if (!movement || (movement.deleted_at && !opts.includeDeleted)) throw notFound('MOVEMENT_NOT_FOUND');
  try {
    return { movement, access: await getAccountAccess(movement.account_id, userId, opts.supervision) };
  } catch (err) {
    if (err instanceof HttpError && err.code === 'ACCOUNT_NOT_FOUND') throw notFound('MOVEMENT_NOT_FOUND');
    throw err;
  }
}

/** La categoría debe ser del grupo; para usarla en algo nuevo, además, estar habilitada. */
async function checkCategory(familyId: string, categoryId: string, currentId: string | null) {
  const category = await categoriesRepository.find(categoryId);
  if (!category || category.family_id !== familyId) throw badRequest('CATEGORY_NOT_FOUND');
  if (category.disabled_at && category.id !== currentId) throw badRequest('CATEGORY_DISABLED');
  return category;
}

const categoryName = async (id: string | null) => (id ? ((await categoriesRepository.find(id))?.name ?? null) : null);

export interface MovementInput {
  id?: string;
  kind: 'in' | 'out';
  amount: number;
  date: string;
  description: string;
  categoryId: string;
}

export const movementsService = {
  async listForAccount(accountId: string, userId: string, supervision: boolean) {
    const access = await getAccountAccess(accountId, userId, supervision);
    const [rows, hiddenColumns, visible] = await Promise.all([
      movementsRepository.listForAccount(accountId),
      movementsRepository.hiddenColumns(accountId, userId),
      visibleAccountIds(access.account.family_id, userId, access.role),
    ]);
    return { movements: rows.map((m) => toMovementView(m, access.account.prefix, visible)), hiddenColumns };
  },

  async create(accountId: string, userId: string, input: MovementInput) {
    const access = await getAccountAccess(accountId, userId);
    requireEdit(access);
    const id = input.id ?? randomUUID();
    const existing = await movementsRepository.find(id);
    if (existing) {
      // Reenvío de la misma creación: no se duplica
      if (existing.account_id !== accountId) throw badRequest('MOVEMENT_ID_TAKEN');
      return { id };
    }
    await checkCategory(access.account.family_id, input.categoryId, null);
    await withTransaction(async (conn) => {
      const number = await accountsRepository.nextNumber(accountId, conn);
      const created = await movementsRepository.create(
        { id, accountId, number, kind: input.kind, amount: input.amount, date: input.date, description: input.description, categoryId: input.categoryId, userId },
        conn,
      );
      if (created) await movementsRepository.addHistory(id, userId, 'created', null, conn);
    });
    return { id };
  },

  async update(id: string, userId: string, changes: Partial<Omit<MovementInput, 'id'>> & { amount?: number }) {
    const { movement, access } = await movementAccess(id, userId);
    requireEdit(access);
    if (movement.kind === 'opening') throw badRequest('MOVEMENT_NOT_EDITABLE');
    if (isTransfer(movement)) return transfers.update(movement, userId, changes);

    const isAdjust = movement.kind === 'adjust';
    const next = {
      kind: (isAdjust ? 'adjust' : (changes.kind ?? movement.kind)) as MovementKind,
      amount: changes.amount ?? movement.amount,
      date: changes.date ?? movement.date,
      description: changes.description ?? movement.description,
      categoryId: isAdjust ? null : (changes.categoryId ?? movement.category_id),
    };
    if (isAdjust ? next.amount === 0 : next.amount <= 0) throw badRequest('MOVEMENT_AMOUNT_INVALID');
    if (!isAdjust) {
      if (!next.categoryId) throw badRequest('CATEGORY_REQUIRED');
      await checkCategory(access.account.family_id, next.categoryId, movement.category_id);
    }

    // Historial: solo lo que cambió, con el nombre de la categoría para leerlo después
    const diff: Record<string, [unknown, unknown]> = {};
    if (next.kind !== movement.kind) diff.kind = [movement.kind, next.kind];
    if (next.amount !== movement.amount) diff.amount = [movement.amount, next.amount];
    if (next.date !== movement.date) diff.date = [movement.date, next.date];
    if (next.description !== movement.description) diff.description = [movement.description, next.description];
    if (next.categoryId !== movement.category_id) {
      diff.category = [await categoryName(movement.category_id), await categoryName(next.categoryId)];
    }
    if (!Object.keys(diff).length) return { id };

    await withTransaction(async (conn) => {
      await movementsRepository.update(id, next, userId, conn);
      await movementsRepository.addHistory(id, userId, 'updated', diff, conn);
    });
    return { id };
  },

  async remove(id: string, userId: string) {
    const { movement, access } = await movementAccess(id, userId);
    requireEdit(access);
    if (movement.kind === 'opening') throw badRequest('MOVEMENT_NOT_EDITABLE');
    if (isTransfer(movement)) return transfers.setDeleted(movement, userId, true);
    await withTransaction(async (conn) => {
      await movementsRepository.setDeleted(id, true, userId, conn);
      await movementsRepository.addHistory(id, userId, 'deleted', null, conn);
    });
  },

  /** Deshacer un borrado */
  async restore(id: string, userId: string) {
    const { movement, access } = await movementAccess(id, userId, { includeDeleted: true });
    requireEdit(access);
    if (!movement.deleted_at) return { id };
    if (isTransfer(movement)) {
      await transfers.setDeleted(movement, userId, false);
      return { id };
    }
    await withTransaction(async (conn) => {
      await movementsRepository.setDeleted(id, false, userId, conn);
      await movementsRepository.addHistory(id, userId, 'restored', null, conn);
    });
    return { id };
  },

  async history(id: string, userId: string, supervision: boolean) {
    await movementAccess(id, userId, { supervision });
    const rows = await movementsRepository.history(id);
    return rows.map((h) => ({
      id: h.id,
      action: h.action,
      changes: h.changes,
      actor: h.actor_id ? { id: h.actor_id, nickname: h.actor_nickname } : null,
      at: h.created_at,
    }));
  },

  /** Ajustar saldo: crea un movimiento por la diferencia entre el saldo real y el de la app. */
  async adjust(accountId: string, userId: string, input: { id?: string; balance: number; date: string; description: string }) {
    const access = await getAccountAccess(accountId, userId);
    requireEdit(access);
    const id = input.id ?? randomUUID();
    if (await movementsRepository.find(id)) return { id };
    await withTransaction(async (conn) => {
      const diff = round2(input.balance - (await movementsRepository.balance(accountId, conn)));
      if (diff === 0) throw badRequest('NOTHING_TO_ADJUST');
      const number = await accountsRepository.nextNumber(accountId, conn);
      await movementsRepository.create(
        { id, accountId, number, kind: 'adjust', amount: diff, date: input.date, description: input.description, categoryId: null, userId },
        conn,
      );
      await movementsRepository.addHistory(id, userId, 'created', null, conn);
    });
    return { id };
  },

  /** Descripciones usadas antes que empiezan con el texto (en las cuentas que la persona ve) */
  async suggestions(familyId: string, userId: string, query: string) {
    const role = await requireMember(familyId, userId);
    const q = query.trim();
    if (!q) return [];
    const accounts = [...(await visibleAccountIds(familyId, userId, role))];
    if (!accounts.length) return [];
    const rows = await movementsRepository.suggestions(accounts, q);
    return rows.map((r) => ({ description: r.description, kind: r.kind, categoryId: r.category_id }));
  },

  async setHiddenColumns(accountId: string, userId: string, columns: string[]) {
    await getAccountAccess(accountId, userId);
    await movementsRepository.setHiddenColumns(accountId, userId, columns);
    return { hiddenColumns: columns };
  },
};

export interface TransferInput {
  /** Ids generados por el dispositivo: la transferencia y sus dos movimientos (así funciona sin conexión) */
  id?: string;
  outId?: string;
  inId?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string;
}

/**
 * Transferencias entre cuentas del grupo: una salida en una cuenta y una entrada en otra, enlazadas.
 * Crearlas, cambiarlas o borrarlas pide poder editar las dos cuentas; los cambios se aplican a las dos mitades.
 */
const transfers = {
  /** Permiso de edición en ambas cuentas; si alguna no se ve, la otra "no existe" para la persona */
  async bothEditable(fromId: string, toId: string, userId: string, existing = false) {
    const [from, to] = await Promise.all([getAccountAccess(fromId, userId), getAccountAccess(toId, userId)]).catch((err) => {
      // En una transferencia que ya existe, la otra cuenta puede ser una que la persona no ve
      if (existing && err instanceof HttpError && err.code === 'ACCOUNT_NOT_FOUND') throw forbidden('TRANSFER_READ_ONLY');
      throw err;
    });
    requireEdit(from);
    requireEdit(to);
    if (from.account.family_id !== to.account.family_id) throw badRequest('TRANSFER_OTHER_FAMILY');
    return { from, to };
  },

  async pair(movement: MovementRow) {
    const pair = await movementsRepository.transferPair(movement.transfer_id!);
    const out = pair.find((m) => m.kind === 'transfer_out')!;
    const inn = pair.find((m) => m.kind === 'transfer_in')!;
    return { out, inn };
  },

  async update(movement: MovementRow, userId: string, changes: Partial<Omit<MovementInput, 'id'>>) {
    if ((changes.kind && changes.kind !== (movement.kind as string)) || changes.categoryId) throw badRequest('TRANSFER_FIELDS_FIXED');
    const { out, inn } = await transfers.pair(movement);
    await transfers.bothEditable(out.account_id, inn.account_id, userId, true);
    const next = {
      amount: changes.amount ?? movement.amount,
      date: changes.date ?? movement.date,
      description: changes.description ?? movement.description,
    };
    if (next.amount <= 0) throw badRequest('MOVEMENT_AMOUNT_INVALID');
    const diff: Record<string, [unknown, unknown]> = {};
    if (next.amount !== movement.amount) diff.amount = [movement.amount, next.amount];
    if (next.date !== movement.date) diff.date = [movement.date, next.date];
    if (next.description !== movement.description) diff.description = [movement.description, next.description];
    if (!Object.keys(diff).length) return { id: movement.id };
    await withTransaction(async (conn) => {
      for (const m of [out, inn]) {
        await movementsRepository.update(m.id, { ...next, kind: m.kind, categoryId: null }, userId, conn);
        await movementsRepository.addHistory(m.id, userId, 'updated', diff, conn);
      }
    });
    return { id: movement.id };
  },

  async setDeleted(movement: MovementRow, userId: string, deleted: boolean) {
    const { out, inn } = await transfers.pair(movement);
    await transfers.bothEditable(out.account_id, inn.account_id, userId, true);
    await withTransaction(async (conn) => {
      for (const m of [out, inn]) {
        await movementsRepository.setDeleted(m.id, deleted, userId, conn);
        await movementsRepository.addHistory(m.id, userId, deleted ? 'deleted' : 'restored', null, conn);
      }
    });
  },
};

export const transfersService = {
  async create(userId: string, input: TransferInput) {
    if (input.fromAccountId === input.toAccountId) throw badRequest('TRANSFER_SAME_ACCOUNT');
    const transferId = input.id ?? randomUUID();
    const outId = input.outId ?? randomUUID();
    const inId = input.inId ?? randomUUID();
    await transfers.bothEditable(input.fromAccountId, input.toAccountId, userId);

    // Reenvío de la misma transferencia (cola sin conexión): no se duplica
    const existing = await movementsRepository.find(outId);
    if (existing) {
      if (existing.transfer_id !== transferId) throw badRequest('MOVEMENT_ID_TAKEN');
      return { id: transferId, outId, inId };
    }
    await withTransaction(async (conn) => {
      const base = { amount: input.amount, date: input.date, description: input.description, categoryId: null, userId, transferId };
      const outNumber = await accountsRepository.nextNumber(input.fromAccountId, conn);
      await movementsRepository.create({ ...base, id: outId, accountId: input.fromAccountId, number: outNumber, kind: 'transfer_out' }, conn);
      const inNumber = await accountsRepository.nextNumber(input.toAccountId, conn);
      await movementsRepository.create({ ...base, id: inId, accountId: input.toAccountId, number: inNumber, kind: 'transfer_in' }, conn);
      await movementsRepository.addHistory(outId, userId, 'created', null, conn);
      await movementsRepository.addHistory(inId, userId, 'created', null, conn);
    });
    return { id: transferId, outId, inId };
  },
};
