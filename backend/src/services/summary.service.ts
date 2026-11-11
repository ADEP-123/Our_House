import { badRequest } from '../lib/http-error.js';
import { MAX_PERIODS, buildPeriods, buildSummary, type SummaryFreq } from '../lib/summary.js';
import { accountsRepository } from '../repositories/accounts.repository.js';
import { categoriesRepository } from '../repositories/categories.repository.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { summaryRepository } from '../repositories/summary.repository.js';
import { visibleAccountIds } from './accounts.service.js';
import { requireMember } from './families.service.js';

export interface SummaryQuery {
  from: string;
  to: string;
  freq: SummaryFreq;
  /** Cuentas elegidas; si no vienen, todas las activas que la persona ve */
  accounts?: string[];
}

export const summaryService = {
  async get(familyId: string, userId: string, q: SummaryQuery) {
    const role = await requireMember(familyId, userId);
    if (q.from > q.to) throw badRequest('SUMMARY_RANGE_INVALID');
    if (buildPeriods(q.from, q.to, q.freq).length > MAX_PERIODS) throw badRequest('SUMMARY_TOO_MANY_PERIODS');

    const visible = await visibleAccountIds(familyId, userId, role);
    const all = [
      ...(await accountsRepository.listForFamily(familyId, userId, false)),
      ...(await accountsRepository.listForFamily(familyId, userId, true)),
    ].filter((a) => visible.has(a.id));
    // Sin elección: las activas. Con elección: solo las que la persona ve (también archivadas)
    const accounts = q.accounts?.length ? all.filter((a) => q.accounts!.includes(a.id)) : all.filter((a) => !a.archived_at);

    const [movements, categories, family] = await Promise.all([
      accounts.length ? summaryRepository.movements(accounts.map((a) => a.id), q.to) : Promise.resolve([]),
      categoriesRepository.listForFamily(familyId),
      familiesRepository.findById(familyId),
    ]);
    return {
      currency: family?.currency ?? 'USD',
      // Todas las cuentas que se pueden elegir (para los filtros)
      available: all.map((a) => ({ id: a.id, name: a.name, kind: a.kind, archived: !!a.archived_at })),
      ...buildSummary({ ...q, accounts, categories, movements }),
    };
  },

  async prefs(familyId: string, userId: string) {
    await requireMember(familyId, userId);
    return { config: await summaryRepository.prefs(familyId, userId) };
  },

  async setPrefs(familyId: string, userId: string, config: unknown) {
    await requireMember(familyId, userId);
    await summaryRepository.setPrefs(familyId, userId, config);
    return { config };
  },
};
