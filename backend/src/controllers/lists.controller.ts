import type { Request, Response } from 'express';
import { secretsService } from '../services/secrets.service.js';
import { currentUserId } from '../middlewares/auth.js';
import { getAccess, listsService } from '../services/lists.service.js';

const listId = (req: Request) => String(req.params.listId);

export const listsController = {
  async listForFamily(req: Request, res: Response): Promise<void> {
    const archived = req.query.archived === 'true';
    res.json(await listsService.listForFamily(String(req.params.familyId), currentUserId(req), archived));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ list: await listsService.create(String(req.params.familyId), currentUserId(req), req.body) });
  },

  async detail(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.detail(listId(req), currentUserId(req), req.query.supervision === 'true') });
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.update(listId(req), currentUserId(req), req.body) });
  },

  async archive(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.setArchived(listId(req), currentUserId(req), true) });
  },

  async restore(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.setArchived(listId(req), currentUserId(req), false) });
  },

  async remove(req: Request, res: Response): Promise<void> {
    const access = await getAccess(listId(req), currentUserId(req));
    // Las secretas se borran directo (sin archivar), con la lista desbloqueada
    if (access.list.type === 'secret') await secretsService.removeList(listId(req), currentUserId(req), unlockToken(req));
    else await listsService.remove(listId(req), currentUserId(req));
    res.status(204).end();
  },

  async pin(req: Request, res: Response): Promise<void> {
    res.json({ list: await listsService.setPinned(listId(req), currentUserId(req), req.body.pinned) });
  },

  async duplicate(req: Request, res: Response): Promise<void> {
    res.status(201).json({ list: await listsService.duplicate(listId(req), currentUserId(req), req.body) });
  },
};

/** Permiso de desbloqueo de una lista secreta: viaja en un encabezado, nunca en cookies ni en la URL */
export const unlockToken = (req: Request) => req.get('x-unlock-token') ?? undefined;

/** Nada de una lista secreta queda en la caché del navegador ni de intermediarios */
const noStore = (res: Response) => res.set('Cache-Control', 'no-store');

export const secretsController = {
  async unlock(req: Request, res: Response): Promise<void> {
    noStore(res);
    res.json(await secretsService.unlock(listId(req), currentUserId(req), req.body.code, req.body.supervision === true));
  },

  async reveal(req: Request, res: Response): Promise<void> {
    noStore(res);
    res.json(await secretsService.reveal(listId(req), currentUserId(req), unlockToken(req), req.query.supervision === 'true'));
  },

  async create(req: Request, res: Response): Promise<void> {
    res.status(201).json({ item: await secretsService.create(listId(req), currentUserId(req), req.body) });
  },

  async update(req: Request, res: Response): Promise<void> {
    res.json({ item: await secretsService.update(listId(req), String(req.params.itemId), currentUserId(req), unlockToken(req), req.body) });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await secretsService.remove(listId(req), String(req.params.itemId), currentUserId(req));
    res.status(204).end();
  },
};
