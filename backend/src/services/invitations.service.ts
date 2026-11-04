import { withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { badRequest, conflict, notFound } from '../lib/http-error.js';
import { mailer } from '../lib/mailer.js';
import { addMs, DAY } from '../lib/tokens.js';
import { familiesRepository } from '../repositories/families.repository.js';
import { invitationsRepository, type InvitationRow } from '../repositories/invitations.repository.js';
import { usersRepository } from '../repositories/users.repository.js';
import { requireLeader } from './families.service.js';

const INVITATION_TTL = 7 * DAY;

export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

/** "expirada" se calcula: pendiente con la fecha vencida. */
const statusOf = (i: InvitationRow): InvitationStatus =>
  i.status === 'pending' && i.expires_at <= new Date() ? 'expired' : i.status;

async function sendInvitationEmail(invitation: InvitationRow, inviterId: string): Promise<void> {
  const [inviter, family, invitee] = await Promise.all([
    usersRepository.findById(inviterId),
    familiesRepository.findById(invitation.family_id),
    usersRepository.findByEmail(invitation.email),
  ]);
  // El correo sale en el idioma de quien lo recibe si ya tiene cuenta; si no, en el de quien invita
  const locale = (invitee?.locale ?? inviter?.locale ?? 'es') as Locale;
  await mailer.send(
    invitation.email,
    emailTemplates.familyInvitation(locale, {
      inviter: inviter?.nickname ?? 'Our House',
      family: family?.name ?? '',
      url: `${env.appUrl}/familias`,
    }),
  );
}

export const invitationsService = {
  /** target: un correo o un apodo de alguien que ya tiene cuenta. */
  async invite(familyId: string, inviterId: string, target: string) {
    await requireLeader(familyId, inviterId);
    const byEmail = target.includes('@');
    const user = byEmail ? await usersRepository.findByEmail(target) : await usersRepository.findByNickname(target);
    if (!byEmail && !user) throw notFound('USER_NOT_FOUND');

    const email = user?.email ?? target;
    if (user && (await familiesRepository.getRole(familyId, user.id))) throw conflict('ALREADY_MEMBER');
    if (await invitationsRepository.findPending(familyId, email)) throw conflict('INVITATION_PENDING');

    const invitation = await invitationsRepository.create({
      familyId,
      invitedBy: inviterId,
      email,
      invitedUserId: user?.id ?? null,
      expiresAt: addMs(INVITATION_TTL),
    });
    await sendInvitationEmail(invitation, inviterId);
    return { id: invitation.id };
  },

  async listForFamily(familyId: string, userId: string) {
    await requireLeader(familyId, userId);
    const rows = await invitationsRepository.listForFamily(familyId);
    return rows.map((i) => ({
      id: i.id,
      email: i.email,
      status: statusOf(i),
      invitedBy: i.inviter_nickname,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    }));
  },

  /** Reenviar: vuelve a dar 7 días y manda otra vez el correo (sirve también para las expiradas). */
  async resend(familyId: string, invitationId: string, userId: string): Promise<void> {
    await requireLeader(familyId, userId);
    const invitation = await invitationsRepository.findById(invitationId);
    if (!invitation || invitation.family_id !== familyId) throw notFound('INVITATION_NOT_FOUND');
    if (invitation.status !== 'pending') throw badRequest('INVITATION_CLOSED');
    await invitationsRepository.renew(invitation.id, addMs(INVITATION_TTL));
    await sendInvitationEmail(invitation, userId);
  },

  async cancel(familyId: string, invitationId: string, userId: string): Promise<void> {
    await requireLeader(familyId, userId);
    const invitation = await invitationsRepository.findById(invitationId);
    if (!invitation || invitation.family_id !== familyId) throw notFound('INVITATION_NOT_FOUND');
    if (invitation.status !== 'pending') throw badRequest('INVITATION_CLOSED');
    await invitationsRepository.setStatus(invitation.id, 'cancelled');
  },

  async listMine(userId: string) {
    const user = (await usersRepository.findById(userId))!;
    const rows = await invitationsRepository.listPendingFor(userId, user.email);
    return rows.map((i) => ({
      id: i.id,
      family: { id: i.family_id, name: i.family_name, avatarUrl: i.family_avatar_url, avatarPreset: i.family_avatar_preset },
      invitedBy: i.inviter_nickname,
      expiresAt: i.expires_at,
    }));
  },

  async respond(invitationId: string, userId: string, accept: boolean) {
    const user = (await usersRepository.findById(userId))!;
    return withTransaction(async (conn) => {
      const invitation = await invitationsRepository.findById(invitationId, conn);
      const isMine = invitation && (invitation.email === user.email || invitation.invited_user_id === userId);
      if (!invitation || !isMine) throw notFound('INVITATION_NOT_FOUND');
      const status = statusOf(invitation);
      if (status === 'expired') throw badRequest('INVITATION_EXPIRED');
      if (status !== 'pending') throw badRequest('INVITATION_CLOSED');

      if (!accept) {
        await invitationsRepository.setStatus(invitation.id, 'rejected', conn);
        return null;
      }
      await familiesRepository.addMember(invitation.family_id, userId, 'member', conn);
      await invitationsRepository.acceptAllFor(invitation.family_id, userId, user.email, conn);
      return { familyId: invitation.family_id };
    });
  },
};
