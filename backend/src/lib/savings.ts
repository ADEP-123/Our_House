import type { AllocationRow, SavingsProjectRow } from '../repositories/savings.repository.js';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ahorro apartado en una cuenta: total y por proyecto (solo proyectos abiertos) */
export function savingsByAccount(allocations: AllocationRow[], projects: Pick<SavingsProjectRow, 'id' | 'name' | 'icon'>[]) {
  const names = new Map(projects.map((p) => [p.id, p]));
  const result = new Map<string, { total: number; projects: { id: string; name: string; icon: string; amount: number }[] }>();
  for (const a of allocations) {
    const entry = result.get(a.account_id) ?? { total: 0, projects: [] };
    const p = names.get(a.project_id);
    entry.total = r2(entry.total + a.amount);
    if (p) entry.projects.push({ id: p.id, name: p.name, icon: p.icon, amount: r2(a.amount) });
    result.set(a.account_id, entry);
  }
  return result;
}
