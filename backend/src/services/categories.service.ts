import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/database.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/http-error.js';
import { categoriesRepository, type CategoryRow } from '../repositories/categories.repository.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { visibleAccountIds } from './accounts.service.js';
import { requireMember } from './families.service.js';

/** Categorías con que empieza cada grupo, en el idioma de quien abre finanzas por primera vez */
const DEFAULT_CATEGORIES: Record<'es' | 'en', [name: string, icon: string, color: string][]> = {
  es: [
    ['Alimentación', '🍽️', 'orange'],
    ['Transporte', '🚗', 'blue'],
    ['Arriendo', '🏠', 'purple'],
    ['Servicios', '💡', 'yellow'],
    ['Salud', '💊', 'red'],
    ['Educación', '📚', 'teal'],
    ['Ocio', '🎉', 'pink'],
    ['Deporte', '🏋️', 'green'],
    ['Ingresos', '💰', 'green'],
    ['Otros', '📦', 'gray'],
  ],
  en: [
    ['Food', '🍽️', 'orange'],
    ['Transport', '🚗', 'blue'],
    ['Rent', '🏠', 'purple'],
    ['Utilities', '💡', 'yellow'],
    ['Health', '💊', 'red'],
    ['Education', '📚', 'teal'],
    ['Leisure', '🎉', 'pink'],
    ['Sports', '🏋️', 'green'],
    ['Income', '💰', 'green'],
    ['Other', '📦', 'gray'],
  ],
};

export function toCategoryView(c: CategoryRow) {
  return { id: c.id, name: c.name, icon: c.icon, color: c.color, disabled: !!c.disabled_at, usage: c.usage };
}

/** Categoría del grupo y rol del usuario; solo los líderes la cambian. */
async function getForLeader(id: string, userId: string) {
  const category = await categoriesRepository.find(id);
  if (!category) throw notFound('CATEGORY_NOT_FOUND');
  const role = await familiesRepository.getRole(category.family_id, userId);
  if (!role) throw notFound('CATEGORY_NOT_FOUND');
  if (role !== 'leader') throw forbidden('NOT_LEADER');
  return { category, role };
}

async function seedIfNeeded(familyId: string, userId: string): Promise<void> {
  const family = await familiesRepository.findById(familyId);
  if (!family || family.categories_seeded) return;
  const locale = (await usersRepository.findById(userId))?.locale ?? 'es';
  await withTransaction(async (conn) => {
    if (!(await categoriesRepository.claimSeed(familyId, conn))) return;
    for (const [name, icon, color] of DEFAULT_CATEGORIES[locale]) {
      await categoriesRepository.create({ id: randomUUID(), familyId, name, icon, color, createdBy: null }, conn);
    }
  });
}

export interface CategoryInput {
  id?: string;
  name: string;
  icon: string;
  color: string;
}

export const categoriesService = {
  /** Todas las categorías del grupo (también las deshabilitadas) y si el usuario puede cambiarlas. */
  async listForFamily(familyId: string, userId: string) {
    const role = await requireMember(familyId, userId);
    await seedIfNeeded(familyId, userId);
    const rows = await categoriesRepository.listForFamily(familyId);
    return { canManage: role === 'leader', categories: rows.map(toCategoryView) };
  },

  async create(familyId: string, userId: string, input: CategoryInput) {
    if ((await requireMember(familyId, userId)) !== 'leader') throw forbidden('NOT_LEADER');
    const id = input.id ?? randomUUID();
    const existing = await categoriesRepository.find(id);
    if (!existing) {
      if (await categoriesRepository.nameTaken(familyId, input.name, null)) throw conflict('CATEGORY_NAME_TAKEN');
      await categoriesRepository.create({ id, familyId, name: input.name, icon: input.icon, color: input.color, createdBy: userId });
    }
    return toCategoryView((await categoriesRepository.find(id))!);
  },

  async update(id: string, userId: string, input: Partial<CategoryInput> & { disabled?: boolean }) {
    const { category } = await getForLeader(id, userId);
    if (input.name && (await categoriesRepository.nameTaken(category.family_id, input.name, id))) throw conflict('CATEGORY_NAME_TAKEN');
    await categoriesRepository.update(id, input);
    return toCategoryView((await categoriesRepository.find(id))!);
  },

  /**
   * Movimientos con esta categoría, para elegir a dónde pasar cada uno antes de borrarla.
   * Solo los de cuentas que el líder puede ver; del resto se informa cuántos hay.
   */
  async movements(id: string, userId: string) {
    const { category, role } = await getForLeader(id, userId);
    const visible = await visibleAccountIds(category.family_id, userId, role);
    const rows = await categoriesRepository.movements(id);
    const shown = rows.filter((m) => visible.has(m.account_id));
    return {
      movements: shown.map((m) => ({
        id: m.id,
        account: { id: m.account_id, name: m.account_name },
        code: `${m.prefix}${String(m.number).padStart(4, '0')}`,
        kind: m.kind,
        amount: m.amount,
        date: m.date,
        description: m.description,
      })),
      hiddenCount: rows.length - shown.length,
    };
  },

  /**
   * Borra la categoría. Si tiene movimientos, moveTo (obligatorio) es a dónde van todos;
   * overrides cambia el destino de movimientos puntuales (de cuentas que el líder ve).
   */
  async remove(id: string, userId: string, body: { moveTo?: string | null; overrides?: { movementId: string; categoryId: string }[] }) {
    const { category, role } = await getForLeader(id, userId);
    const overrides = body.overrides ?? [];
    if (category.usage > 0 && !body.moveTo) throw conflict('CATEGORY_IN_USE');

    const targets = new Set([...(body.moveTo ? [body.moveTo] : []), ...overrides.map((o) => o.categoryId)]);
    const familyCategories = new Set((await categoriesRepository.listForFamily(category.family_id)).map((c) => c.id));
    for (const t of targets) {
      if (t === id || !familyCategories.has(t)) throw badRequest('CATEGORY_TARGET_INVALID');
    }

    // Solo se pueden elegir movimientos que el líder ve
    const visible = await visibleAccountIds(category.family_id, userId, role);
    const allowed = new Set((await categoriesRepository.movements(id)).filter((m) => visible.has(m.account_id)).map((m) => m.id));
    const byTarget = new Map<string, string[]>();
    for (const o of overrides) {
      if (!allowed.has(o.movementId)) continue;
      byTarget.set(o.categoryId, [...(byTarget.get(o.categoryId) ?? []), o.movementId]);
    }

    await withTransaction(async (conn) => {
      for (const [target, ids] of byTarget) await categoriesRepository.moveMovements(id, ids, target, conn);
      if (body.moveTo) await categoriesRepository.moveAll(id, body.moveTo, conn);
      await categoriesRepository.delete(id, conn);
    });
  },
};
