import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool } from './db';
import type { AuthenticatedRequest } from './types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const MAX_KEY_LENGTH = 128;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_WAIT_MS = 30_000;
const PENDING_POLL_MS = 100;
const PENDING_STALE_SECONDS = 60;

interface IdempotencyRow extends RowDataPacket {
  request_hash: string;
  status: string;
  response_status: number | string | null;
  response_body: unknown;
}

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

type Reservation =
  | { kind: 'owner' }
  | { kind: 'replay'; response: StoredResponse }
  | { kind: 'conflict' }
  | { kind: 'pending' };

type WaitResult = StoredResponse | 'conflict' | null;

function stableSerialize(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function requestPath(request: Request): string {
  const [path] = request.originalUrl.split('?');
  return path ?? request.originalUrl;
}

function requestHash(request: Request): string {
  const fingerprint = [
    request.method.toUpperCase(),
    requestPath(request),
    stableSerialize(request.body)
  ].join('\n');
  return createHash('sha256').update(fingerprint).digest('hex');
}

function parseResponse(row: IdempotencyRow): StoredResponse | null {
  if (row.status !== 'COMPLETED' || row.response_status === null || row.response_body === null) {
    return null;
  }

  let body = row.response_body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }

  return {
    statusCode: Number(row.response_status),
    body
  };
}

async function findRow(adminId: number, key: string): Promise<IdempotencyRow | null> {
  const [rows] = await getPool().execute<IdempotencyRow[]>(
    `SELECT request_hash, status, response_status, response_body
       FROM admin_idempotency_keys
      WHERE admin_id = ? AND idempotency_key = ?
      LIMIT 1`,
    [adminId, key]
  );
  return rows[0] ?? null;
}

async function waitForCompletion(adminId: number, key: string, hash: string): Promise<WaitResult> {
  const deadline = Date.now() + PENDING_WAIT_MS;
  while (Date.now() < deadline) {
    const row = await findRow(adminId, key);
    if (!row) {
      return null;
    }
    if (row.request_hash !== hash) {
      return 'conflict';
    }
    const response = parseResponse(row);
    if (response) {
      return response;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, PENDING_POLL_MS));
  }
  return null;
}

async function reserveKey(adminId: number, key: string, hash: string): Promise<Reservation> {
  const pool = getPool();
  await pool.execute(
    'DELETE FROM admin_idempotency_keys WHERE expires_at <= CURRENT_TIMESTAMP LIMIT 1000'
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const expiresAt = new Date(Date.now() + KEY_TTL_MS);
    const [insertResult] = await pool.execute<ResultSetHeader>(
      `INSERT IGNORE INTO admin_idempotency_keys
        (admin_id, idempotency_key, request_hash, status, expires_at)
       VALUES (?, ?, ?, 'PENDING', ?)`,
      [adminId, key, hash, expiresAt]
    );
    if (insertResult.affectedRows === 1) {
      return { kind: 'owner' };
    }

    const existing = await findRow(adminId, key);
    if (!existing) {
      continue;
    }
    if (existing.request_hash !== hash) {
      return { kind: 'conflict' };
    }

    const response = parseResponse(existing);
    if (response) {
      return { kind: 'replay', response };
    }

    const completed = await waitForCompletion(adminId, key, hash);
    if (completed === 'conflict') {
      return { kind: 'conflict' };
    }
    if (completed) {
      return { kind: 'replay', response: completed };
    }

    const [staleResult] = await pool.execute<ResultSetHeader>(
      `DELETE FROM admin_idempotency_keys
        WHERE admin_id = ?
          AND idempotency_key = ?
          AND status = 'PENDING'
          AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${PENDING_STALE_SECONDS} SECOND)`,
      [adminId, key]
    );
    if (staleResult.affectedRows === 0) {
      return { kind: 'pending' };
    }
  }

  return { kind: 'pending' };
}

async function completeKey(
  adminId: number,
  key: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  await getPool().execute(
    `UPDATE admin_idempotency_keys
        SET status = 'COMPLETED',
            response_status = ?,
            response_body = ?,
            completed_at = CURRENT_TIMESTAMP
      WHERE admin_id = ? AND idempotency_key = ? AND status = 'PENDING'`,
    [statusCode, JSON.stringify(body), adminId, key]
  );
}

async function releaseKey(adminId: number, key: string): Promise<void> {
  await getPool().execute(
    `DELETE FROM admin_idempotency_keys
      WHERE admin_id = ? AND idempotency_key = ? AND status = 'PENDING'`,
    [adminId, key]
  );
}

function captureResponse(
  response: Response,
  adminId: number,
  key: string
): void {
  const originalJson = response.json.bind(response);
  let captured = false;

  response.once('close', () => {
    if (!captured) {
      void releaseKey(adminId, key).catch((error: unknown) => {
        console.error('Failed to release idempotency key:', error);
      });
    }
  });

  response.json = ((body: unknown) => {
    if (captured) {
      return originalJson(body);
    }
    captured = true;
    void (async () => {
      try {
        await completeKey(adminId, key, response.statusCode, body);
      } catch (error) {
        console.error('Failed to persist idempotent response:', error);
        await releaseKey(adminId, key).catch((releaseError: unknown) => {
          console.error('Failed to release idempotency key:', releaseError);
        });
      } finally {
        originalJson(body);
      }
    })();
    return response;
  }) as typeof response.json;
}

function sendIdempotencyError(response: Response, message: string, statusCode = 200): void {
  response.status(statusCode).json({
    code: statusCode === 409 ? 9999 : 1001,
    message,
    data: null
  });
}

async function handleIdempotency(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  if (!MUTATING_METHODS.has(request.method) || requestPath(request) === '/api/logout') {
    next();
    return;
  }

  const rawKey = request.get('Idempotency-Key');
  const key = rawKey?.trim();
  if (!key || key.length > MAX_KEY_LENGTH) {
    sendIdempotencyError(response, '缺少或无效的 Idempotency-Key');
    return;
  }

  const adminId = (request as AuthenticatedRequest).adminId;
  if (typeof adminId !== 'number') {
    next();
    return;
  }

  const hash = requestHash(request);
  const reservation = await reserveKey(adminId, key, hash);
  if (reservation.kind === 'replay') {
    response.status(reservation.response.statusCode).json(reservation.response.body);
    return;
  }
  if (reservation.kind === 'conflict') {
    sendIdempotencyError(response, '同一 Idempotency-Key 不可用于不同请求');
    return;
  }
  if (reservation.kind === 'pending') {
    sendIdempotencyError(response, '幂等请求正在处理中，请稍后重试', 409);
    return;
  }

  captureResponse(response, adminId, key);
  next();
}

export const idempotencyMiddleware: RequestHandler = (request, response, next) => {
  void handleIdempotency(request, response, next).catch(next);
};
