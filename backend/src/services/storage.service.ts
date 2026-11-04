import { del, put } from '@vercel/blob';
import { HttpError } from '../lib/http-error.js';

/** Archivos públicos (avatares) en Vercel Blob. Requiere BLOB_READ_WRITE_TOKEN (se crea al conectar el Blob store). */
export const storageService = {
  async upload(pathname: string, data: Buffer, contentType: string): Promise<string> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, 'UPLOADS_NOT_CONFIGURED');
    const blob = await put(pathname, data, { access: 'public', contentType, addRandomSuffix: true });
    return blob.url;
  },

  /** Borra un archivo anterior; si falla no interrumpe la operación del usuario. */
  async remove(url: string | null | undefined): Promise<void> {
    if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return;
    await del(url).catch((err: unknown) => console.warn('No se pudo borrar el archivo', url, err));
  },
};
