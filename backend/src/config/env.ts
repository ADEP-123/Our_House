const optional = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export const env = {
  port: Number(optional('PORT') ?? 3000),
  nodeEnv: optional('NODE_ENV') ?? 'development',
  isProduction: optional('NODE_ENV') === 'production',
  /** URL pública de la PWA; se usa en los enlaces de los correos */
  appUrl: (optional('APP_URL') ?? 'http://localhost:4200').replace(/\/$/, ''),
  db: {
    // Cadena "pooled" de Neon: postgresql://usuario:clave@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
    url: optional('DATABASE_URL'),
    poolMax: Number(optional('DB_POOL_MAX') ?? 5),
  },
  mail: {
    // Gmail SMTP con contraseña de aplicación. Sin estas variables los correos se escriben en la consola.
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    fromName: optional('MAIL_FROM_NAME') ?? 'Our House',
  },
} as const;
