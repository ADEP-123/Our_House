import { withConnection } from '../config/database.js';

export const healthRepository = {
  /** Consulta mínima para confirmar que PostgreSQL responde. */
  async ping(): Promise<boolean> {
    return withConnection(async (client) => {
      const result = await client.query<{ ok: number }>('SELECT 1 AS ok');
      return result.rows[0]?.ok === 1;
    });
  },
};
