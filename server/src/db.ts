import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { config } from './config';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      charset: 'utf8mb4',
      timezone: '+08:00',
      dateStrings: ['DATETIME']
    });
  }
  return pool;
}

export async function withTransaction<T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export function isDuplicateEntryError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

export type DbRow = RowDataPacket;
