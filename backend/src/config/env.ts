const optional = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export const env = {
  port: Number(optional('PORT') ?? 3000),
  nodeEnv: optional('NODE_ENV') ?? 'development',
  db: {
    user: optional('DB_USER'),
    password: optional('DB_PASSWORD'),
    connectString: optional('DB_CONNECT_STRING'),
    walletDir: optional('DB_WALLET_DIR'),
    walletPassword: optional('DB_WALLET_PASSWORD'),
    poolMax: Number(optional('DB_POOL_MAX') ?? 4),
  },
} as const;
