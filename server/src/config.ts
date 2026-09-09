import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function readString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readPositiveInt(name: string, fallback: number): number {
  const rawValue = readString(name, String(fallback));
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const config = {
  nodeEnv: readString('NODE_ENV', 'development'),
  port: readPositiveInt('PORT', 3000),
  clientOrigin: readString('CLIENT_ORIGIN', 'http://localhost:5173'),
  tokenTtlSeconds: readPositiveInt('TOKEN_TTL_SECONDS', 86400),
  adminInitialUsername: readString('ADMIN_INITIAL_USERNAME', 'admin'),
  adminInitialPassword: readString('ADMIN_INITIAL_PASSWORD', '123456'),
  db: {
    host: readString('DB_HOST', '127.0.0.1'),
    port: readPositiveInt('DB_PORT', 3306),
    name: readString('DB_NAME', 'user_dashboard'),
    user: readString('DB_USER', 'user_dashboard_app'),
    password: readString('DB_PASSWORD', ''),
    connectionLimit: readPositiveInt('DB_CONNECTION_LIMIT', 10)
  },
  clientDistPath: path.resolve(__dirname, '../../client/dist')
};
