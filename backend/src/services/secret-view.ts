import type { SecretItemRow } from '../repositories/secret-items.repository.js';

/** Lo que se ve de un elemento secreto sin código: el título y quién lo creó */
export const toSecretSummary = (item: SecretItemRow, userId: string) => ({
  id: item.id,
  title: item.title,
  createdBy: { id: item.created_by, nickname: item.creator_nickname },
  mine: item.created_by === userId,
  updatedAt: item.updated_at,
});
