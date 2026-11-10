import { familiesRepository } from '../repositories/families.repository.js';
import { itemsRepository } from '../repositories/items.repository.js';

/**
 * Turno siguiente: la próxima persona de la lista de turnos que siga en el grupo.
 * Devuelve null si no hay turnos (o nadie de los turnos sigue en el grupo).
 */
export async function nextTurn(familyId: string, rotation: string[] | null, index: number): Promise<{ assigneeId: string; rotationIndex: number } | null> {
  if (!rotation?.length) return null;
  for (let step = 1; step <= rotation.length; step++) {
    const i = (index + step) % rotation.length;
    if (await familiesRepository.getRole(familyId, rotation[i]!)) return { assigneeId: rotation[i]!, rotationIndex: i };
  }
  return null;
}

/**
 * Las que se repiten sin fecha ("Leche cada semana") vuelven a pendiente cuando llega su día,
 * con el turno siguiente. Se llama al abrir listas, en Mis tareas y en el envío de cada hora.
 */
export async function reopenDueItems(): Promise<void> {
  const reopened = await itemsRepository.reopenDue();
  for (const item of reopened) {
    if (!item.rotation?.length) continue;
    const turn = await nextTurn(item.family_id, item.rotation, item.rotation_index);
    if (turn) await itemsRepository.setTurn(item.id, turn.assigneeId, turn.rotationIndex);
  }
}
