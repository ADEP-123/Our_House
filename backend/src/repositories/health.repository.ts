import { withConnection } from '../config/database.js';

export const healthRepository = {
  /** Consulta mínima a Oracle. También mantiene activa la Autonomous DB (se detiene tras 7 días sin uso). */
  async ping(): Promise<boolean> {
    return withConnection(async (conn) => {
      const result = await conn.execute<[number]>('SELECT 1 FROM DUAL');
      return result.rows?.[0]?.[0] === 1;
    });
  },
};
