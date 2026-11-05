const optional = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const nodeEnv = optional('NODE_ENV') ?? 'development';
const isProduction = nodeEnv === 'production';

const jwtSecret = optional('JWT_SECRET');
if (isProduction && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET es obligatorio en producción (mínimo 32 caracteres)');
}

export const env = {
  port: Number(optional('PORT') ?? 3000),
  nodeEnv,
  isProduction,
  jwtSecret: jwtSecret ?? 'solo-para-desarrollo-cambia-esto-en-produccion',
  /** URL pública de la PWA; se usa en los enlaces de los correos */
  appUrl: (optional('APP_URL') ?? 'http://localhost:4200').replace(/\/$/, ''),
  db: {
    // Cadena "pooled" de Neon: postgresql://usuario:clave@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
    url: optional('DATABASE_URL'),
    poolMax: Number(optional('DB_POOL_MAX') ?? 5),
  },
  /** Días que una lista archivada espera antes de borrarse definitivamente */
  listArchiveRetentionDays: Math.max(1, Number(optional('LIST_ARCHIVE_RETENTION_DAYS') ?? 15)),
  /** Clave que debe traer quien dispara los recordatorios (workflow de GitHub cada hora). Sin ella, el envío queda apagado. */
  cronSecret: optional('CRON_SECRET'),
  /** Clave maestra de las listas secretas: 32 bytes en base64 (openssl rand -base64 32). Si se pierde, no se pueden leer. */
  secretsKey: optional('SECRETS_KEY'),
  /** Google Calendar (OAuth). Sin estas variables la opción de conectar el calendario no aparece. */
  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
  },
  mail: {
    // Gmail SMTP con contraseña de aplicación. Sin estas variables los correos se escriben en la consola.
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    fromName: optional('MAIL_FROM_NAME') ?? 'Our House',
  },
} as const;
