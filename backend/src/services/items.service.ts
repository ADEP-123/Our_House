import { randomUUID } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../lib/http-error.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { itemsRepository, type ItemFields } from '../repositories/items.repository.js';
import { getAccess, listsService, requireEdit, toItemView, type ListAccess } from './lists.service.js';

/** El responsable de una tarea tiene que ser del grupo. */
async function checkAssignee(access: ListAccess, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  if (!(await familiesRepository.getRole(access.list.family_id, assigneeId))) throw badRequest('ASSIGNEE_NOT_MEMBER');
}

async function getItem(access: ListAccess, itemId: string) {
  const item = await itemsRepository.find(itemId);
  if (!item || item.list_id !== access.list.id) throw notFound('ITEM_NOT_FOUND');
  return item;
}

export const itemsService = {
  async create(listId: string, userId: string, data: ItemFields & { id?: string; text: string }) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    await checkAssignee(access, data.assigneeId);
    const id = data.id ?? randomUUID();
    const created = await itemsRepository.create(listId, id, userId, data);
    const item = await itemsRepository.find(id);
    // Reenvío del mismo ítem (cola sin conexión): válido solo si es de esta lista
    if (!created && item?.list_id !== listId) throw conflict('ITEM_ID_TAKEN');
    return toItemView(item!);
  },

  async update(listId: string, itemId: string, userId: string, data: ItemFields) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    await getItem(access, itemId);
    await checkAssignee(access, data.assigneeId);
    await itemsRepository.update(itemId, listId, data);
    return toItemView((await itemsRepository.find(itemId))!);
  },

  /** Marcar y desmarcar: cualquiera que vea la lista (no en modo supervisión) mientras no esté archivada. */
  async setCompleted(listId: string, itemId: string, userId: string, completed: boolean) {
    const access = await getAccess(listId, userId);
    if (!access.canCheck) throw forbidden(access.list.archived_at ? 'LIST_ARCHIVED' : 'LIST_READ_ONLY');
    await getItem(access, itemId);
    await itemsRepository.setCompleted(itemId, listId, completed, userId);
    return toItemView((await itemsRepository.find(itemId))!);
  },

  /** Borrar es idempotente: si ya no existe responde igual (reintentos sin conexión). */
  async remove(listId: string, itemId: string, userId: string): Promise<void> {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    const item = await itemsRepository.find(itemId);
    if (!item) return;
    if (item.list_id !== listId) throw notFound('ITEM_NOT_FOUND');
    await itemsRepository.delete(itemId, listId);
  },

  async uncheckAll(listId: string, userId: string) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    await itemsRepository.uncheckAll(listId);
    return listsService.detail(listId, userId);
  },

  async deleteCompleted(listId: string, userId: string) {
    const access = await getAccess(listId, userId);
    requireEdit(access);
    await itemsRepository.deleteCompleted(listId);
    return listsService.detail(listId, userId);
  },
};
