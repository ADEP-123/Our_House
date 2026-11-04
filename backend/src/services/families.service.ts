import { randomInt } from 'node:crypto';
import type { Db } from '../config/database.js';
import { withTransaction } from '../config/database.js';
import { detectImage, MAX_AVATAR_BYTES } from '../lib/avatars.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/http-error.js';
import { familiesRepository, type FamilyRole, type FamilyRow } from '../repositories/families.repository.js';
import { invitationsRepository } from '../repositories/invitations.repository.js';
import { storageService } from './storage.service.js';

// Sin 0/O ni 1/I/L para que se pueda dictar en voz alta sin confusiones
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newInviteCode = (): string => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** Rol del usuario en el grupo. Si no es miembro responde 404: no revela si el grupo existe. */
export async function requireMember(familyId: string, userId: string): Promise<FamilyRole> {
  const role = await familiesRepository.getRole(familyId, userId);
  if (!role) throw notFound('FAMILY_NOT_FOUND');
  return role;
}

export async function requireLeader(familyId: string, userId: string): Promise<void> {
  if ((await requireMember(familyId, userId)) !== 'leader') throw forbidden('NOT_LEADER');
}

const familyAvatar = (f: FamilyRow) => ({ avatarUrl: f.avatar_url, avatarPreset: f.avatar_preset });

/**
 * Saca a un usuario del grupo dentro de una transacción.
 * Si era el último líder, asciende al miembro más antiguo; si no queda nadie, borra el grupo.
 * Devuelve la URL del avatar del grupo si este se eliminó (para borrar el archivo después).
 */
export async function removeFromFamily(familyId: string, userId: string, conn: Db): Promise<string | null> {
  const members = await familiesRepository.lockMembers(familyId, conn);
  const remaining = members.filter((m) => m.user_id !== userId);

  if (!remaining.length) {
    const family = await familiesRepository.findById(familyId, conn);
    await familiesRepository.delete(familyId, conn);
    return family?.avatar_url ?? null;
  }
  await familiesRepository.removeMember(familyId, userId, conn);
  if (!remaining.some((m) => m.role === 'leader')) {
    await familiesRepository.setRole(familyId, remaining[0]!.user_id, 'leader', conn);
  }
  return null;
}

export const familiesService = {
  async listMine(userId: string) {
    const rows = await familiesRepository.listForUser(userId);
    return rows.map((f) => ({ id: f.id, name: f.name, ...familyAvatar(f), role: f.role, memberCount: f.member_count }));
  },

  async create(userId: string, name: string) {
    return withTransaction(async (conn) => {
      const family = await familiesRepository.create(name, newInviteCode(), userId, conn);
      await familiesRepository.addMember(family.id, userId, 'leader', conn);
      return { id: family.id, name: family.name, ...familyAvatar(family), role: 'leader' as const, memberCount: 1 };
    });
  },

  async detail(familyId: string, userId: string) {
    const role = await requireMember(familyId, userId);
    const family = (await familiesRepository.findById(familyId))!;
    const members = await familiesRepository.listMembers(familyId);
    return {
      id: family.id,
      name: family.name,
      ...familyAvatar(family),
      role,
      // El código solo lo ven los líderes: con él cualquiera puede entrar al grupo
      inviteCode: role === 'leader' ? family.invite_code : null,
      members: members.map((m) => ({
        userId: m.user_id,
        nickname: m.nickname,
        firstName: m.first_name,
        lastName: m.last_name,
        avatarUrl: m.avatar_url,
        avatarPreset: m.avatar_preset,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    };
  },

  async rename(familyId: string, userId: string, name: string) {
    await requireLeader(familyId, userId);
    await familiesRepository.update(familyId, { name });
    return this.detail(familyId, userId);
  },

  async uploadAvatar(familyId: string, userId: string, data: Buffer) {
    await requireLeader(familyId, userId);
    if (!data?.length) throw badRequest('FILE_REQUIRED');
    if (data.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE');
    const image = detectImage(data);
    if (!image) throw badRequest('FILE_TYPE_NOT_ALLOWED');

    const before = (await familiesRepository.findById(familyId))!;
    const url = await storageService.upload(`avatars/families/${familyId}.${image.ext}`, data, image.type);
    await familiesRepository.update(familyId, { avatarUrl: url, avatarPreset: null });
    await storageService.remove(before.avatar_url);
    return this.detail(familyId, userId);
  },

  async setAvatarPreset(familyId: string, userId: string, preset: string | null) {
    await requireLeader(familyId, userId);
    const before = (await familiesRepository.findById(familyId))!;
    await familiesRepository.update(familyId, { avatarUrl: null, avatarPreset: preset });
    await storageService.remove(before.avatar_url);
    return this.detail(familyId, userId);
  },

  async regenerateInviteCode(familyId: string, userId: string) {
    await requireLeader(familyId, userId);
    const family = await familiesRepository.update(familyId, { inviteCode: newInviteCode() });
    return { inviteCode: family.invite_code };
  },

  async joinWithCode(userId: string, email: string, code: string) {
    const family = await familiesRepository.findByInviteCode(code.trim().toUpperCase());
    if (!family) throw notFound('INVITE_CODE_INVALID');
    await withTransaction(async (conn) => {
      if (!(await familiesRepository.addMember(family.id, userId, 'member', conn))) throw conflict('ALREADY_MEMBER');
      await invitationsRepository.acceptAllFor(family.id, userId, email, conn);
    });
    return { id: family.id, name: family.name };
  },

  /** Nombrar o quitar líderes. Siempre debe quedar al menos uno. */
  async setRole(familyId: string, actorId: string, targetId: string, role: FamilyRole) {
    await requireLeader(familyId, actorId);
    await withTransaction(async (conn) => {
      const members = await familiesRepository.lockMembers(familyId, conn);
      const target = members.find((m) => m.user_id === targetId);
      if (!target) throw notFound('MEMBER_NOT_FOUND');
      if (role === 'member' && target.role === 'leader' && members.filter((m) => m.role === 'leader').length === 1) {
        throw conflict('LAST_LEADER');
      }
      await familiesRepository.setRole(familyId, targetId, role, conn);
    });
    return this.detail(familyId, actorId);
  },

  async expel(familyId: string, actorId: string, targetId: string) {
    await requireLeader(familyId, actorId);
    if (actorId === targetId) throw badRequest('USE_LEAVE');
    if (!(await familiesRepository.getRole(familyId, targetId))) throw notFound('MEMBER_NOT_FOUND');
    await withTransaction((conn) => removeFromFamily(familyId, targetId, conn));
    return this.detail(familyId, actorId);
  },

  async leave(familyId: string, userId: string): Promise<void> {
    await requireMember(familyId, userId);
    const avatarUrl = await withTransaction((conn) => removeFromFamily(familyId, userId, conn));
    await storageService.remove(avatarUrl);
  },
};
