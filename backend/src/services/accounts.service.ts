import { randomUUID } from 'node:crypto';
import { withTransaction, type Db } from '../config/database.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/http-error.js';
import {
  accountsRepository,
  type AccountFields,
  type AccountKind,
  type AccountViewRow,
  type EditMode,
  type ViewMode,
} from '../repositories/accounts.repository.js';
import { familiesRepository, type FamilyRole } from '../repositories/families.repository.js';
import { requireMember } from './families.service.js';

/**
 * Qué puede hacer el usuario con una cuenta.
 * - Ver: todo el grupo, las personas elegidas o solo quien la creó (privada).
 *   Un líder ve las privadas de un supervisado, en modo lectura y tras confirmar.
 * - Administrar (datos de la cuenta, permisos, saldo inicial, archivar, borrar): quien la creó;
 *   si salió del grupo, los líderes.
 * - Editar (movimientos): quien administra, o quien la ve y tiene el rol elegido o está entre los elegidos.
 *   Una cuenta archivada no se edita.
 */
export interface AccountAccess {
  account: AccountViewRow;
  role: FamilyRole;
  supervision: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}

export function computeAccess(a: AccountViewRow, role: FamilyRole, userId: string) {
  const isOwner = a.owner_id === userId;
  const canAdmin = isOwner || (a.owner_id === null && role === 'leader');
  const canView = canAdmin || a.view_mode === 'family' || (a.view_mode === 'members' && a.my_view);
  const byRule = a.view_mode !== 'private' && (a.edit_mode === 'roles' ? a.edit_roles.includes(role) : a.my_edit);
  const canEdit = canView && !a.archived_at && (canAdmin || byRule);
  return { canView, canAdmin, canEdit };
}

const isSupervisedPrivate = (a: AccountViewRow, role: FamilyRole, userId: string) =>
  a.view_mode === 'private' && role === 'leader' && a.owner_role === 'supervised' && a.owner_id !== userId;

/** Ids de las cuentas del grupo (activas y archivadas) que el usuario puede ver normalmente. */
export async function visibleAccountIds(familyId: string, userId: string, role: FamilyRole): Promise<Set<string>> {
  const rows = [
    ...(await accountsRepository.listForFamily(familyId, userId, false)),
    ...(await accountsRepository.listForFamily(familyId, userId, true)),
  ];
  return new Set(rows.filter((a) => computeAccess(a, role, userId).canView).map((a) => a.id));
}

/** @param supervision el líder confirmó el aviso para ver la cuenta privada de un supervisado */
export async function getAccountAccess(id: string, userId: string, supervision = false, conn?: Db): Promise<AccountAccess> {
  const account = await accountsRepository.find(id, userId, conn);
  if (!account) throw notFound('ACCOUNT_NOT_FOUND');
  const role = await familiesRepository.getRole(account.family_id, userId, conn);
  if (!role) throw notFound('ACCOUNT_NOT_FOUND');

  const { canView, canAdmin, canEdit } = computeAccess(account, role, userId);
  if (canView) return { account, role, supervision: false, canEdit, canAdmin };
  if (!isSupervisedPrivate(account, role, userId)) throw notFound('ACCOUNT_NOT_FOUND');
  if (!supervision) throw forbidden('SUPERVISION_CONFIRMATION_REQUIRED');
  return { account, role, supervision: true, canEdit: false, canAdmin: false };
}

function requireAdmin(access: AccountAccess): void {
  if (!access.canAdmin) throw forbidden('ACCOUNT_ADMIN_ONLY');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toAccountView(a: AccountViewRow, access: Pick<AccountAccess, 'canEdit' | 'canAdmin' | 'supervision'>) {
  const balance = round2(a.balance);
  const debt = round2(Math.max(0, -balance));
  return {
    id: a.id,
    familyId: a.family_id,
    name: a.name,
    description: a.description,
    kind: a.kind,
    prefix: a.prefix,
    currency: a.currency,
    balance,
    // Tarjeta de crédito: cupo, deuda (saldo negativo) y lo que queda por usar
    credit:
      a.kind === 'credit'
        ? { limit: a.credit_limit ?? 0, debt, available: round2((a.credit_limit ?? 0) - debt), overLimit: debt > (a.credit_limit ?? 0) }
        : null,
    opening: a.opening_amount === null ? null : { amount: a.opening_amount, date: a.opening_date, number: a.opening_number },
    viewMode: a.view_mode,
    editMode: a.edit_mode,
    editRoles: a.edit_roles,
    viewers: a.viewer_ids,
    editors: a.editor_ids,
    owner: a.owner_id ? { id: a.owner_id, nickname: a.owner_nickname } : null,
    archivedAt: a.archived_at,
    createdAt: a.created_at,
    permissions: { canEdit: access.canEdit, canAdmin: access.canAdmin, supervision: access.supervision },
  };
}

export interface AccountInput {
  id?: string;
  name: string;
  description?: string | null;
  kind: AccountKind;
  prefix: string;
  creditLimit?: number | null;
  /** Saldo inicial; en tarjetas, la deuda va en negativo. Monto 0 o null: sin saldo inicial. */
  opening?: { amount: number; date: string } | null;
  viewMode: ViewMode;
  editMode: EditMode;
  editRoles: FamilyRole[];
  viewers: string[];
  editors: string[];
}

/** Valida y arma los campos y las personas elegidas. */
async function prepare(familyId: string, ownerId: string | null, input: AccountInput, exceptId: string | null, conn: Db) {
  if (await accountsRepository.prefixTaken(familyId, input.prefix, exceptId, conn)) throw conflict('ACCOUNT_PREFIX_TAKEN');
  if (input.kind === 'credit' && input.creditLimit == null) throw badRequest('CREDIT_LIMIT_REQUIRED');

  const members = new Set((await familiesRepository.listMembers(familyId)).map((m) => m.user_id));
  const chosen = [...input.viewers, ...input.editors];
  if (chosen.some((id) => !members.has(id))) throw badRequest('ACCOUNT_MEMBER_INVALID');

  const fields: AccountFields = {
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    prefix: input.prefix,
    creditLimit: input.kind === 'credit' ? input.creditLimit! : null,
    viewMode: input.viewMode,
    editMode: input.editMode,
    editRoles: input.editRoles,
  };

  // Quien administra no necesita estar en la lista; en una privada no hay elegidos
  const editors = new Set(input.viewMode === 'private' || input.editMode !== 'members' ? [] : input.editors);
  const viewers = new Set(input.viewMode === 'members' ? [...input.viewers, ...editors] : []);
  editors.delete(ownerId ?? '');
  viewers.delete(ownerId ?? '');
  const access = [...new Set([...viewers, ...editors])].map((userId) => ({
    userId,
    canView: viewers.has(userId) || editors.has(userId),
    canEdit: editors.has(userId),
  }));
  return { fields, access };
}

async function saveOpening(accountId: string, opening: AccountInput['opening'], userId: string, conn: Db) {
  if (opening && opening.amount !== 0) await accountsRepository.setOpening(accountId, opening.amount, opening.date, userId, conn);
  else await accountsRepository.removeOpening(accountId, conn);
}

async function view(id: string, userId: string) {
  const access = await getAccountAccess(id, userId);
  return toAccountView(access.account, access);
}

export const accountsService = {
  async listForFamily(familyId: string, userId: string, archived: boolean) {
    const role = await requireMember(familyId, userId);
    const rows = await accountsRepository.listForFamily(familyId, userId, archived);
    const family = await familiesRepository.findById(familyId);
    const accounts = [];
    const supervisedPrivate = [];
    for (const a of rows) {
      const access = computeAccess(a, role, userId);
      if (access.canView) accounts.push(toAccountView(a, { ...access, supervision: false }));
      // Solo el dueño: el nombre y los montos se revelan después del aviso de privacidad
      else if (!archived && isSupervisedPrivate(a, role, userId)) supervisedPrivate.push({ id: a.id, ownerNickname: a.owner_nickname });
    }
    return { currency: family?.currency ?? 'USD', accounts, supervisedPrivate };
  },

  async detail(id: string, userId: string, supervision: boolean) {
    const access = await getAccountAccess(id, userId, supervision);
    return toAccountView(access.account, access);
  },

  async create(familyId: string, userId: string, input: AccountInput) {
    await requireMember(familyId, userId);
    const id = input.id ?? randomUUID();
    await withTransaction(async (conn) => {
      const { fields, access } = await prepare(familyId, userId, input, id, conn);
      if (!(await accountsRepository.create(id, familyId, userId, fields, conn))) return; // reenvío
      await accountsRepository.setAccess(id, access, conn);
      await saveOpening(id, input.opening, userId, conn);
    });
    return view(id, userId);
  },

  async update(id: string, userId: string, input: AccountInput) {
    const current = await getAccountAccess(id, userId);
    requireAdmin(current);
    if (current.account.archived_at) throw forbidden('ACCOUNT_ARCHIVED');
    await withTransaction(async (conn) => {
      const { fields, access } = await prepare(current.account.family_id, current.account.owner_id, input, id, conn);
      await accountsRepository.update(id, fields, conn);
      await accountsRepository.setAccess(id, access, conn);
      await saveOpening(id, input.opening, userId, conn);
    });
    return view(id, userId);
  },

  async setArchived(id: string, userId: string, archived: boolean) {
    requireAdmin(await getAccountAccess(id, userId));
    await accountsRepository.setArchived(id, archived);
    return view(id, userId);
  },

  async remove(id: string, userId: string) {
    requireAdmin(await getAccountAccess(id, userId));
    await accountsRepository.delete(id);
  },
};
