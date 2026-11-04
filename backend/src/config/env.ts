const optional = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export const env = {
  port: Number(optional('PORT') ?? 3000),
  nodeEnv: optional('NODE_ENV') ?? 'development',
  db: {
    // Cadena "pooled" de Neon: postgresql://usuario:clave@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
    url: optional('DATABASE_URL'),
    poolMax: Number(optional('DB_POOL_MAX') ?? 5),
  },
} as const;
