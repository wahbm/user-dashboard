import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from './config';
import { getPool } from './db';
import { sendFailure } from './response';
import type { AuthenticatedRequest } from './types';

interface SessionRow extends RowDataPacket {
  admin_id: number | string;
}

export const TOKEN_ERROR_CODE = 1003;
export const TOKEN_ERROR_MESSAGE = 'Token无效或已过期';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(adminId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.tokenTtlSeconds * 1000);
  const pool = getPool();
  await pool.execute<ResultSetHeader>(
    'INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [adminId, tokenHash, expiresAt]
  );
  return token;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authorization = req.header('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      sendFailure(res, TOKEN_ERROR_CODE, TOKEN_ERROR_MESSAGE);
      return;
    }

    const token = match[1];
    if (!token) {
      sendFailure(res, TOKEN_ERROR_CODE, TOKEN_ERROR_MESSAGE);
      return;
    }
    const tokenHash = hashToken(token);
    const [rows] = await getPool().execute<SessionRow[]>(
      `SELECT s.admin_id
         FROM admin_sessions s
         INNER JOIN admin_accounts a ON a.id = s.admin_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
          AND a.status = 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      sendFailure(res, TOKEN_ERROR_CODE, TOKEN_ERROR_MESSAGE);
      return;
    }

    const session = rows[0];
    if (!session) {
      sendFailure(res, TOKEN_ERROR_CODE, TOKEN_ERROR_MESSAGE);
      return;
    }

    const authenticatedRequest = req as AuthenticatedRequest;
    authenticatedRequest.adminId = Number(session.admin_id);
    authenticatedRequest.tokenHash = tokenHash;
    next();
  } catch (error) {
    next(error);
  }
}

export async function revokeSession(tokenHash: string): Promise<void> {
  await getPool().execute<ResultSetHeader>(
    'UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL',
    [tokenHash]
  );
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
