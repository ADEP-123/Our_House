import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/database.js';
import { badRequest, forbidden, notFound } from '../lib/http-error.js';
import { todayIn } from '../lib/recurrence.js';
import { accountsRepository, type AccountViewRow } from '../repositories/accounts.repository.js';
import { categoriesRepository } from '../repositories/categories.repository.js';
import { familiesRepository, type FamilyRole } from '../repositories/families.repository.js';
import { savingsByAccount } from '../lib/savings.js';
import { savingsRepository, type AllocationRow, type SavingsProjectRow } from '../repositories/savings.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { computeAccess, getAccountAccess } from './accounts.service.js';
import { financeAlerts } from './finance-alerts.service.js';
import { requireMember } from './families.service.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ProjectInput {
  id?: string;
  name: string;
  icon: string;
  goal?: number | null;
  targetDate?: string | null;
}

async function familyAccounts(familyId: string, userId: string) {
  return [...(await accountsRepository.listForFamily(familyId, userId, false)), ...(await accountsRepository.listForFamily(familyId, userId, true))];
}

/** Proyecto y si la persona lo puede cambiar (quien lo creó o un líder) */
async function projectAccess(id: string, userId: string) {
  const project = await savingsRepository.find(id);
  if (!project) throw notFound('SAVINGS_NOT_FOUND');
  const role = await familiesRepository.getRole(project.family_id, userId);
  if (!role) throw notFound('SAVINGS_NOT_FOUND');
  return { project, role, canManage: role === 'leader' || project.created_by === userId };
}

function requireManage(access: { canManage: boolean }) {
  if (!access.canManage) throw forbidden('SAVINGS_MANAGE_ONLY');
}

/** Ahorro apartado de un proyecto en una cuenta */
export async function allocationOf(familyId: string, projectId: string, accountId: string): Promise<number> {
  return (await savingsRepository.allocations(familyId)).find((a) => a.project_id === projectId && a.account_id === accountId)?.amount ?? 0;
}

function viewProject(p: SavingsProjectRow, allocations: AllocationRow[], accounts: Map<string, AccountViewRow>, visible: Set<string>, userId: string, role: FamilyRole) {
  const own = allocations.filter((a) => a.project_id === p.id);
  const hidden = r2(own.filter((a) => !visible.has(a.account_id)).reduce((s, a) => s + a.amount, 0));
  return {
    id: p.id,
    name: p.name,
    icon: p.icon,
    goal: p.goal,
    targetDate: p.target_date,
    closedAt: p.closed_at,
    createdBy: p.created_by ? { id: p.created_by, nickname: p.created_by_nickname } : null,
    canManage: role === 'leader' || p.created_by === userId,
    saved: r2(own.reduce((s, a) => s + a.amount, 0)),
    spent: r2(p.spent),
    // Lo apartado en cuentas que la persona no ve se muestra junto, sin decir dónde
    accounts: [
      ...own
        .filter((a) => visible.has(a.account_id))
        .map((a) => ({ accountId: a.account_id, name: accounts.get(a.account_id)?.name ?? '', amount: r2(a.amount) })),
      ...(hidden > 0 ? [{ accountId: null, name: null, amount: hidden }] : []),
    ],
  };
}

export const savingsService = {
  /** Proyectos del grupo y las cuentas donde se puede apartar (con su saldo, ahorro y disponible) */
  async list(familyId: string, userId: string) {
    const role = await requireMember(familyId, userId);
    const [projects, allocations, all, family] = await Promise.all([
      savingsRepository.listForFamily(familyId),
      savingsRepository.allocations(familyId),
      familyAccounts(familyId, userId),
      familiesRepository.findById(familyId),
    ]);
    const access = new Map(all.map((a) => [a.id, computeAccess(a, role, userId)]));
    const visible = new Set(all.filter((a) => access.get(a.id)!.canView).map((a) => a.id));
    const byId = new Map(all.map((a) => [a.id, a]));
    const saved = savingsByAccount(allocations, projects);
    return {
      currency: family?.currency ?? 'USD',
      projects: projects.map((p) => viewProject(p, allocations, byId, visible, userId, role)),
      accounts: all
        .filter((a) => visible.has(a.id) && !a.archived_at && a.kind !== 'credit')
        .map((a) => {
          const s = saved.get(a.id)?.total ?? 0;
          return { id: a.id, name: a.name, kind: a.kind, balance: r2(a.balance), saved: s, available: r2(a.balance - s), canEdit: access.get(a.id)!.canEdit };
        }),
    };
  },

  async create(familyId: string, userId: string, input: ProjectInput) {
    await requireMember(familyId, userId);
    const id = input.id ?? randomUUID();
    await savingsRepository.create({
      id,
      familyId,
      name: input.name,
      icon: input.icon,
      goal: input.goal ?? null,
      targetDate: input.targetDate ?? null,
      createdBy: userId,
    });
    return { id };
  },

  async update(id: string, userId: string, input: ProjectInput) {
    const access = await projectAccess(id, userId);
    requireManage(access);
    await savingsRepository.update(id, { name: input.name, icon: input.icon, goal: input.goal ?? null, targetDate: input.targetDate ?? null });
    return { id };
  },

  /** Cerrar: libera lo apartado en todas las cuentas y el proyecto deja de recibir */
  async close(id: string, userId: string) {
    const access = await projectAccess(id, userId);
    requireManage(access);
    if (access.project.closed_at) return { id };
    const allocations = (await savingsRepository.allocations(access.project.family_id)).filter((a) => a.project_id === id);
    await withTransaction(async (conn) => {
      for (const a of allocations) {
        await savingsRepository.addEntry({ projectId: id, accountId: a.account_id, kind: 'release', amount: r2(a.amount), actorId: userId }, conn);
      }
      await savingsRepository.setClosed(id, true, conn);
    });
    return { id };
  },

  async reopen(id: string, userId: string) {
    const access = await projectAccess(id, userId);
    requireManage(access);
    await withTransaction((conn) => savingsRepository.setClosed(id, false, conn));
    return { id };
  },

  async remove(id: string, userId: string) {
    requireManage(await projectAccess(id, userId));
    await savingsRepository.delete(id);
  },

  /** Apartar (sin pasar del disponible de la cuenta) o liberar (sin pasar de lo apartado) */
  async move(id: string, userId: string, input: { accountId: string; action: 'set_aside' | 'release'; amount: number }) {
    const { project } = await projectAccess(id, userId);
    if (project.closed_at) throw badRequest('SAVINGS_CLOSED');
    const account = await getAccountAccess(input.accountId, userId);
    if (account.account.family_id !== project.family_id) throw badRequest('SAVINGS_ACCOUNT_INVALID');
    if (account.account.kind === 'credit') throw badRequest('SAVINGS_CREDIT_ACCOUNT');
    if (!account.canEdit) throw forbidden(account.account.archived_at ? 'ACCOUNT_ARCHIVED' : 'ACCOUNT_READ_ONLY');

    const allocations = await savingsRepository.allocations(project.family_id);
    const inAccount = allocations.filter((a) => a.account_id === input.accountId);
    const amount = r2(input.amount);
    if (input.action === 'set_aside') {
      const available = r2(account.account.balance - inAccount.reduce((s, a) => s + a.amount, 0));
      if (amount > available) throw badRequest('SAVINGS_NOT_ENOUGH', { available });
    } else {
      const current = inAccount.find((a) => a.project_id === id)?.amount ?? 0;
      if (amount > r2(current)) throw badRequest('SAVINGS_RELEASE_TOO_MUCH', { saved: r2(current) });
    }
    await savingsRepository.addEntry({ projectId: id, accountId: input.accountId, kind: input.action, amount, actorId: userId });
    if (input.action === 'set_aside') financeAlerts.afterSetAside(id, input.accountId, userId);
    return { id };
  },

  async history(id: string, userId: string) {
    const { project, role } = await projectAccess(id, userId);
    const all = await familyAccounts(project.family_id, userId);
    const visible = new Map(all.filter((a) => computeAccess(a, role, userId).canView).map((a) => [a.id, a.name]));
    return (await savingsRepository.history(id)).map((h) => ({
      kind: h.kind,
      amount: r2(h.amount),
      account: visible.has(h.account_id) ? { id: h.account_id, name: visible.get(h.account_id)! } : null,
      actor: h.actor_id ? { id: h.actor_id, nickname: h.actor_nickname } : null,
      description: visible.has(h.account_id) ? h.description : null,
      date: h.date,
      at: h.at,
    }));
  },

  // ---------- Presupuesto mensual por categoría ----------

  /** Presupuestos con lo gastado en el mes (por defecto el de hoy en la zona de la persona) */
  async budgets(familyId: string, userId: string, month?: string) {
    const role = await requireMember(familyId, userId);
    const m = month ?? todayIn((await usersRepository.findById(userId))?.timezone ?? 'UTC').slice(0, 7);
    const rows = await savingsRepository.budgets(familyId, m);
    return {
      month: m,
      canManage: role === 'leader',
      budgets: rows.map((b) => ({
        categoryId: b.category_id,
        name: b.name,
        icon: b.icon,
        color: b.color,
        disabled: b.disabled,
        limit: r2(b.amount),
        spent: r2(b.spent),
        pct: Math.round((b.spent / b.amount) * 100),
      })),
    };
  },

  /** amount null: quita el presupuesto. Solo líderes. */
  async setBudget(categoryId: string, userId: string, amount: number | null) {
    const category = await categoriesRepository.find(categoryId);
    if (!category) throw notFound('CATEGORY_NOT_FOUND');
    const role = await familiesRepository.getRole(category.family_id, userId);
    if (!role) throw notFound('CATEGORY_NOT_FOUND');
    if (role !== 'leader') throw forbidden('NOT_LEADER');
    if (amount === null) await savingsRepository.removeBudget(categoryId);
    else await savingsRepository.setBudget(categoryId, r2(amount), userId);
    return { categoryId, amount };
  },
};
