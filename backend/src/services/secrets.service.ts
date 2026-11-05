import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { runInBackground } from '../lib/background.js';
import { emailTemplates, type Locale } from '../lib/email-templates.js';
import { badRequest, forbidden, HttpError } from '../lib/http-error.js';
import { mailer } from '../lib/mailer.js';
import { openItem, sealItem } from '../lib/vault.js';
import { listsRepository } from '../repositories/lists.repository.js';
import { secretItemsRepository, type SecretItemRow } from '../repositories/secret-items.repository.js';
import { listRef, logActivity } from './activity.service.js';
import { getAccess, type ListAccess } from './lists.service.js';
import { toSecretSummary } from './secret-view.js';
import { verificationCodesService } from './verification-codes.service.js';

export interface SecretField {
  label: string;
  kind: string;
  value: string;
}

/**
 * Desbloqueo: tras el código del correo, la persona recibe un permiso para esa lista que vive solo
 * en la pantalla abierta (no se guarda en el dispositivo). Dura 30 minutos y se renueva con cada lectura;
 * al salir de la lista se descarta y para volver a ver hay que pedir otro código.
 */
const UNLOCK_TTL = '30m';
const secretKey = () => new TextEncoder().encode(env.jwtSecret);

async function issueUnlock(userId: string, listId: string): Promise<string> {
  return new SignJWT({ lst: listId, purpose: 'secret-unlock' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setExpirationTime(UNLOCK_TTL)
    .sign(secretKey());
}

async function requireUnlock(token: string | undefined, userId: string, listId: string): Promise<void> {
  try {
    if (!token) throw new Error();
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (payload['purpose'] !== 'secret-unlock' || payload.sub !== userId || payload['lst'] !== listId) throw new Error();
  } catch {
    throw new HttpError(401, 'SECRETS_LOCKED');
  }
}

async function secretAccess(listId: string, userId: string, supervision = false): Promise<ListAccess> {
  const access = await getAccess(listId, userId, supervision);
  if (access.list.type !== 'secret') throw badRequest('NOT_A_SECRET_LIST');
  return access;
}

async function ownItem(access: ListAccess, itemId: string, userId: string): Promise<SecretItemRow> {
  const item = await secretItemsRepository.find(itemId);
  if (!item || item.list_id !== access.list.id) throw new HttpError(404, 'ITEM_NOT_FOUND');
  // Editar o borrar: solo quien creó el elemento (ni los líderes)
  if (item.created_by !== userId || access.supervision) throw forbidden('SECRET_NOT_YOURS');
  return item;
}

const seal = (listId: string, itemId: string, fields: SecretField[]) => sealItem(listId, itemId, JSON.stringify(fields));

function log(access: ListAccess, userId: string, action: string, item?: { id: string; title: string }) {
  return logActivity(access.list.family_id, userId, action, {
    ...listRef(access.list),
    ...(item ? { itemId: item.id, itemText: item.title } : {}),
  });
}

/** Aviso a quienes tienen elementos en la lista cuando otra persona ve la información */
function notifyViewers(access: ListAccess, viewerId: string): void {
  runInBackground('correo secretos vistos', async () => {
    const owners = await secretItemsRepository.creatorsOtherThan(access.list.id, viewerId);
    if (!owners.length) return;
    const { rows } = await db().query<{ email: string; locale: Locale; viewer: string }>(
      `SELECT u.email, u.locale, v.nickname AS viewer
         FROM users u, users v
        WHERE u.id = ANY($1) AND v.id = $2 AND u.email_secret_views AND u.email_verified_at IS NOT NULL`,
      [owners, viewerId],
    );
    await Promise.all(
      rows.map((r) =>
        mailer.send(
          r.email,
          emailTemplates.secretsViewed(r.locale, {
            viewer: r.viewer,
            list: access.list.name,
            url: `${env.appUrl}/listas/${access.list.id}`,
            settingsUrl: `${env.appUrl}/perfil#notificaciones`,
          }),
        ),
      ),
    );
  });
}

export const secretsService = {
  /** Verifica el código del correo y entrega el permiso para ver esta lista */
  async unlock(listId: string, userId: string, code: string, supervision = false) {
    const access = await secretAccess(listId, userId, supervision);
    await verificationCodesService.verify(userId, 'secrets', code);
    await log(access, userId, 'secret.viewed');
    notifyViewers(access, userId);
    return { token: await issueUnlock(userId, listId) };
  },

  /** Los valores descifrados (con permiso vigente). Devuelve un permiso renovado. */
  async reveal(listId: string, userId: string, token: string | undefined, supervision = false) {
    await secretAccess(listId, userId, supervision);
    await requireUnlock(token, userId, listId);
    const items = await secretItemsRepository.forList(listId);
    return {
      items: items.map((i) => ({ id: i.id, fields: JSON.parse(openItem(listId, i.id, i.payload_enc)) as SecretField[] })),
      token: await issueUnlock(userId, listId),
    };
  },

  /** Agregar: quien puede editar la lista (su creador o un líder si es del grupo). No hace falta código. */
  async create(listId: string, userId: string, data: { id?: string; title: string; fields: SecretField[] }) {
    const access = await secretAccess(listId, userId);
    if (!access.canEdit) throw forbidden('LIST_READ_ONLY');
    const id = data.id ?? randomUUID();
    const created = await secretItemsRepository.create({ id, listId, title: data.title, payloadEnc: seal(listId, id, data.fields), userId });
    const item = (await secretItemsRepository.find(id))!;
    if (!created && (item.list_id !== listId || item.created_by !== userId)) throw new HttpError(409, 'ITEM_ID_TAKEN');
    if (created) await log(access, userId, 'secret.created', item);
    return toSecretSummary(item, userId);
  },

  /** Editar: solo quien lo creó y con la lista desbloqueada (para editar hay que ver los valores) */
  async update(listId: string, itemId: string, userId: string, token: string | undefined, data: { title?: string; fields?: SecretField[] }) {
    const access = await secretAccess(listId, userId);
    await requireUnlock(token, userId, listId);
    const item = await ownItem(access, itemId, userId);
    await secretItemsRepository.update(itemId, listId, {
      title: data.title,
      payloadEnc: data.fields ? seal(listId, itemId, data.fields) : undefined,
    });
    const after = (await secretItemsRepository.find(itemId))!;
    await log(access, userId, 'secret.updated', { id: item.id, title: after.title });
    return toSecretSummary(after, userId);
  },

  /** Borrado definitivo: solo quien lo creó */
  async remove(listId: string, itemId: string, userId: string): Promise<void> {
    const access = await secretAccess(listId, userId);
    const item = await secretItemsRepository.find(itemId);
    if (!item) return;
    await ownItem(access, itemId, userId);
    await secretItemsRepository.delete(itemId, listId);
    await log(access, userId, 'secret.deleted', item);
  },

  /**
   * Borrar la lista secreta completa, sin pasar por archivadas: solo su dueño, con la lista desbloqueada
   * (si tiene elementos) y si todos los elementos son suyos.
   */
  async removeList(listId: string, userId: string, token: string | undefined): Promise<void> {
    const access = await secretAccess(listId, userId);
    if (access.list.created_by !== userId) throw forbidden('SECRET_LIST_NOT_YOURS');
    // Una lista vacía no tiene nada que proteger: se borra sin código
    if ((await secretItemsRepository.forList(listId)).length) await requireUnlock(token, userId, listId);
    if ((await secretItemsRepository.creatorsOtherThan(listId, userId)).length) throw new HttpError(409, 'SECRET_LIST_HAS_OTHERS_ITEMS');
    await listsRepository.delete(listId);
    await logActivity(access.list.family_id, userId, 'list.deleted', listRef(access.list));
  },
};
