import { healthRepository } from '../repositories/health.repository.js';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptimeSeconds: number;
  timestamp: string;
}

export const healthService = {
  async check(): Promise<HealthStatus> {
    const dbUp = await healthRepository.ping().catch(() => false);
    return {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  },
};
