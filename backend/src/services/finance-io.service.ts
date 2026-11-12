import { randomUUID } from 'node:crypto';
import { db, withTransaction, type Db } from '../config/database.js';
import { badRequest } from '../lib/http-error.js';
import { IMPORT_LIMITS, countStatuses, planImport, type ImportInput, type ImportPlan, type ImportState } from '../lib/import.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { categoriesRepository } from '../repositories/categories.repository.js';
import { familiesRepository, type FamilyRole } from '../repositories/families.repository.js';
import { financeIoRepository } from '../repositories/finance-io.repository.js';
import { computeAccess } from './accounts.service.js';
import { financeAlerts } from './finance-alerts.service.js';
import { requireMember } from './families.service.js';

const code = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}`;

async function familyAccounts(familyId: string, userId: string, conn: Db = db()) {
  return [
    ...(await accountsRepository.listForFamily(familyId, userId, false, conn)),
    ...(await accountsRepository.listForFamily(familyId, userId, true, conn)),
  ];
}

/** Lo que hay hoy en el grupo, visto por quien importa */
async function loadState(familyId: string, userId: string, role: FamilyRole, conn: Db): Promise<ImportState> {
  const [accounts, categories, movements] = [
    await familyAccounts(familyId, userId, conn),
    await categoriesRepository.listForFamily(familyId, conn),
    await financeIoRepository.familyMovements(familyId, conn),
  ];
  return {
    isLeader: role === 'leader',
    accounts: accounts.map((a) => {
      const access = computeAccess(a, role, userId);
      return {
        id: a.id,
        name: a.name,
        prefix: a.prefix,
        kind: a.kind,
        lastNumber: a.last_number,
        visible: access.canView,
        canEdit: access.canEdit,
        canAdmin: access.canAdmin,
        archived: !!a.archived_at,
      };
    }),
    categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, disabled: !!c.disabled_at })),
    movements,
  };
}

async function apply(familyId: string, userId: string, plan: ImportPlan, conn: Db): Promise<void> {
  for (const a of plan.newAccounts) {
    await accountsRepository.create(
      a.id,
      familyId,
      userId,
      {
        name: a.name,
        description: a.description,
        kind: a.kind,
        prefix: a.prefix,
        creditLimit: a.creditLimit,
        viewMode: 'family',
        editMode: 'roles',
        editRoles: ['leader', 'member'],
        lowBalanceThreshold: null,
      },
      conn,
    );
  }
  for (const c of plan.newCategories) {
    await categoriesRepository.create({ id: c.id, familyId, name: c.name, icon: c.icon, color: c.color, createdBy: userId }, conn);
    if (c.disabled) await categoriesRepository.update(c.id, { disabled: true }, conn);
  }
  for (const u of plan.categoryUpdates) await categoriesRepository.update(u.id, u, conn);

  await financeIoRepository.insertMovements(plan.newMovements, userId, conn);
  await financeIoRepository.updateMovements(plan.movementUpdates, userId, conn);
  await financeIoRepository.addHistory(
    [
      ...plan.newMovements.map((m) => ({ movementId: m.id, action: 'created' as const, changes: null })),
      ...plan.movementUpdates.map((u) => ({ movementId: u.id, action: 'updated' as const, changes: u.changes })),
    ],
    userId,
    conn,
  );
  for (const [accountId, n] of plan.lastNumbers) await financeIoRepository.raiseLastNumber(accountId, n, conn);
}

function report(plan: ImportPlan, dryRun: boolean, currency: string) {
  return {
    dryRun,
    currency,
    counts: {
      accounts: countStatuses(plan.accounts),
      categories: countStatuses(plan.categories),
      movements: countStatuses(plan.movements),
    },
    accounts: plan.accounts,
    categories: plan.categories,
    movements: plan.movements,
  };
}

export interface ExportQuery {
  accounts?: string[];
  from?: string;
  to?: string;
}

export const financeIoService = {
  /**
   * Vista previa (dryRun) o importación. Al guardar se vuelve a calcular dentro de la transacción,
   * con el grupo bloqueado, por si algo cambió desde la vista previa.
   */
  async import(familyId: string, userId: string, input: ImportInput, dryRun: boolean) {
    const role = await requireMember(familyId, userId);
    if (
      input.accounts.length > IMPORT_LIMITS.accounts ||
      input.categories.length > IMPORT_LIMITS.categories ||
      input.movements.length > IMPORT_LIMITS.movements
    )
      throw badRequest('IMPORT_TOO_MANY_ROWS');
    if (!input.accounts.length && !input.categories.length && !input.movements.length) throw badRequest('IMPORT_EMPTY');

    const currency = (await familiesRepository.findById(familyId))?.currency ?? 'USD';
    if (dryRun) return report(planImport(input, await loadState(familyId, userId, role, db()), randomUUID), true, currency);
    return withTransaction(async (conn) => {
      await financeIoRepository.lockFamily(familyId, conn);
      const plan = planImport(input, await loadState(familyId, userId, role, conn), randomUUID);
      await apply(familyId, userId, plan, conn);
      return plan;
    }).then((plan) => {
      // Después de guardar: disponible bajo y presupuesto del mes
      const touched = new Set([...plan.newMovements.map((m) => m.accountId)]);
      financeAlerts.afterChange(familyId, [...touched], userId);
      return report(plan, false, currency);
    });
  },

  /**
   * Datos para exportar en el formato v1: movimientos de las cuentas elegidas (las activas que la persona ve
   * si no elige), sus cuentas y las categorías del grupo. Una transferencia sale una sola vez, desde la cuenta de origen.
   */
  async export(familyId: string, userId: string, q: ExportQuery) {
    if (q.from && q.to && q.from > q.to) throw badRequest('SUMMARY_RANGE_INVALID');
    const role = await requireMember(familyId, userId);
    const all = (await familyAccounts(familyId, userId)).filter((a) => computeAccess(a, role, userId).canView);
    const selected = q.accounts?.length ? all.filter((a) => q.accounts!.includes(a.id)) : all.filter((a) => !a.archived_at);
    const byId = new Map(all.map((a) => [a.id, a]));
    const selectedIds = new Set(selected.map((a) => a.id));

    const [rows, categories, family] = await Promise.all([
      selected.length ? financeIoRepository.exportMovements([...selectedIds], q.from ?? null, q.to ?? null) : Promise.resolve([]),
      categoriesRepository.listForFamily(familyId),
      familiesRepository.findById(familyId),
    ]);

    const movements = [];
    for (const m of rows) {
      const own = byId.get(m.account_id)!;
      const other = m.other_account_id ? byId.get(m.other_account_id) : undefined;
      if (m.kind === 'transfer_in') {
        // Ya sale desde la cuenta de origen
        if (m.other_account_id && selectedIds.has(m.other_account_id)) continue;
        movements.push({
          code: other ? code(other.prefix, m.other_number!) : code(own.prefix, m.number),
          account: other?.name ?? null,
          date: m.date,
          description: m.description,
          category: null,
          kind: 'transfer' as const,
          amount: m.amount,
          destination: own.name,
        });
        continue;
      }
      movements.push({
        code: code(own.prefix, m.number),
        account: own.name,
        date: m.date,
        description: m.description,
        category: m.category_name,
        kind: m.kind === 'transfer_out' ? ('transfer' as const) : m.kind,
        amount: m.amount,
        destination: m.kind === 'transfer_out' ? (other?.name ?? null) : null,
      });
    }

    return {
      currency: family?.currency ?? 'USD',
      from: q.from ?? null,
      to: q.to ?? null,
      accounts: selected.map((a) => ({
        name: a.name,
        prefix: a.prefix,
        kind: a.kind,
        description: a.description,
        creditLimit: a.credit_limit,
        balance: Math.round(a.balance * 100) / 100,
        archived: !!a.archived_at,
      })),
      categories: categories.map((c) => ({ name: c.name, icon: c.icon, color: c.color, active: !c.disabled_at })),
      movements,
    };
  },
};
