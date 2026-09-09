import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import swaggerUi from 'swagger-ui-express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CreateUserData,
  CreateUserRequest,
  LoginData,
  UpdateUserRequest,
  UpdateUserStatusRequest,
  UserListData,
  UserListItem,
  UserStatus
} from '@user-dashboard/shared';
import { config } from './config';
import { authenticate, createSession, hashPassword, revokeSession, verifyPassword } from './auth';
import { getPool, isDuplicateEntryError, withTransaction } from './db';
import { sendFailure, sendSuccess } from './response';
import { AuthenticatedRequest } from './types';
import { createOpenApiDocument, getOpenApiServerUrl } from './openapi';
import {
  createUserSchema,
  loginSchema,
  parseBody,
  parseUserId,
  parseUserListQuery,
  updateStatusSchema,
  updateUserSchema,
  ValidationError
} from './validation';

class BusinessError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

interface AdminRow extends RowDataPacket {
  id: number | string;
  username: string;
  password_hash: string;
  status: number;
}

interface CountRow extends RowDataPacket {
  total: number | string;
}

interface UserRow extends RowDataPacket {
  id: number | string;
  username: string;
  name: string;
  mobile: string;
  email: string | null;
  status: number;
  createTime: string;
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '1mb' }));

const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void handler(req, res, next).catch(next);
  };

app.get('/api-docs/openapi.json', (req, res) => {
  res.json(createOpenApiDocument(getOpenApiServerUrl(req)));
});

app.use(
  '/api-docs',
  ...swaggerUi.serve,
  swaggerUi.setup(null, {
    customSiteTitle: '后台用户管理系统 API 文档',
    swaggerOptions: {
      url: './openapi.json'
    }
  })
);

function duplicateUserError(error: unknown): BusinessError {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('uq_users_mobile')) {
    return new BusinessError(2003, '手机号已存在');
  }
  return new BusinessError(2002, '用户名已存在');
}

function ensureAuthenticatedRequest(req: Request): AuthenticatedRequest {
  return req as AuthenticatedRequest;
}

function getUserListItem(row: UserRow): UserListItem {
  return {
    id: Number(row.id),
    username: row.username,
    name: row.name,
    mobile: row.mobile,
    email: row.email ?? '',
    status: Number(row.status) as UserStatus,
    createTime: row.createTime
  };
}

app.post('/api/login', asyncHandler(async (req, res) => {
  const input = parseBody(loginSchema, req.body);
  const [rows] = await getPool().execute<AdminRow[]>(
    `SELECT id, username, password_hash, status
       FROM admin_accounts
      WHERE username = ?
      LIMIT 1`,
    [input.username]
  );

  const account = rows[0];
  if (!account || !(await verifyPassword(input.password, account.password_hash))) {
    sendFailure(res, 1002, '用户名或密码错误');
    return;
  }
  if (Number(account.status) !== 1) {
    sendFailure(res, 2004, '当前账号已被禁用');
    return;
  }

  const token = await createSession(Number(account.id));
  const data: LoginData = { token };
  sendSuccess(res, data);
}));

app.use('/api', authenticate);

app.get('/api/users', asyncHandler(async (req, res) => {
  const query = parseUserListQuery(req.query as Record<string, unknown>);
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (query.username) {
    conditions.push('username LIKE ?');
    values.push(`%${query.username}%`);
  }
  if (query.mobile) {
    conditions.push('mobile = ?');
    values.push(query.mobile);
  }
  if (query.status !== undefined) {
    conditions.push('status = ?');
    values.push(query.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const pool = getPool();
  const [countRows] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS total FROM users ${whereClause}`,
    values
  );
  const offset = (query.page - 1) * query.pageSize;
  const [userRows] = await pool.execute<UserRow[]>(
    `SELECT id, username, name, mobile, COALESCE(email, '') AS email, status,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS createTime
       FROM users
       ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...values, query.pageSize, offset]
  );

  const data: UserListData = {
    total: Number(countRows[0]?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    list: userRows.map(getUserListItem)
  };
  sendSuccess(res, data);
}));

app.post('/api/users', asyncHandler(async (req, res) => {
  const input = parseBody(createUserSchema, req.body) as CreateUserRequest;
  const passwordHash = await hashPassword(input.password);

  try {
    const id = await withTransaction(async (connection) => {
      const [adminRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM admin_accounts WHERE username = ? LIMIT 1',
        [input.username]
      );
      if (adminRows.length > 0) {
        throw new BusinessError(2002, '用户名已存在');
      }

      const [existingRows] = await connection.execute<RowDataPacket[]>(
        'SELECT username, mobile FROM users WHERE username = ? OR mobile = ? LIMIT 1',
        [input.username, input.mobile]
      );
      if (existingRows.length > 0) {
        const existing = existingRows[0] as { username?: string; mobile?: string };
        if (existing.mobile === input.mobile) {
          throw new BusinessError(2003, '手机号已存在');
        }
        throw new BusinessError(2002, '用户名已存在');
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (username, name, mobile, email, password_hash, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [input.username, input.name, input.mobile, input.email || null, passwordHash, input.status]
      );
      return Number(result.insertId);
    });

    const data: CreateUserData = { id };
    sendSuccess(res, data, '新增成功');
  } catch (error) {
    if (error instanceof BusinessError) {
      throw error;
    }
    if (isDuplicateEntryError(error)) {
      throw duplicateUserError(error);
    }
    throw error;
  }
}));

app.put('/api/users/:id', asyncHandler(async (req, res) => {
  const id = parseUserId(req.params.id);
  const input = parseBody(updateUserSchema, req.body) as UpdateUserRequest;
  const pool = getPool();
  const [existingRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (existingRows.length === 0) {
    throw new BusinessError(2001, '用户不存在');
  }

  const [mobileRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM users WHERE mobile = ? AND id <> ? LIMIT 1',
    [input.mobile, id]
  );
  if (mobileRows.length > 0) {
    throw new BusinessError(2003, '手机号已存在');
  }

  try {
    if (input.email === undefined) {
      await pool.execute<ResultSetHeader>(
        'UPDATE users SET name = ?, mobile = ? WHERE id = ?',
        [input.name, input.mobile, id]
      );
    } else {
      await pool.execute<ResultSetHeader>(
        'UPDATE users SET name = ?, mobile = ?, email = ? WHERE id = ?',
        [input.name, input.mobile, input.email || null, id]
      );
    }
  } catch (error) {
    if (isDuplicateEntryError(error)) {
      throw duplicateUserError(error);
    }
    throw error;
  }

  sendSuccess(res, null, '修改成功');
}));

app.patch('/api/users/:id/status', asyncHandler(async (req, res) => {
  const id = parseUserId(req.params.id);
  const input = parseBody(updateStatusSchema, req.body) as UpdateUserStatusRequest;
  const pool = getPool();
  const [existingRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (existingRows.length === 0) {
    throw new BusinessError(2001, '用户不存在');
  }
  await pool.execute<ResultSetHeader>('UPDATE users SET status = ? WHERE id = ?', [input.status, id]);
  sendSuccess(res, null, '操作成功');
}));

app.post('/api/users/:id/reset-password', asyncHandler(async (req, res) => {
  const id = parseUserId(req.params.id);
  const pool = getPool();
  const [existingRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  if (existingRows.length === 0) {
    throw new BusinessError(2001, '用户不存在');
  }
  const resetPasswordHash = await bcrypt.hash('Aa123456', 12);
  await pool.execute<ResultSetHeader>(
    'UPDATE users SET password_hash = ? WHERE id = ?',
    [resetPasswordHash, id]
  );
  sendSuccess(res, null, '密码重置成功');
}));

app.post('/api/logout', asyncHandler(async (req, res) => {
  const authenticatedRequest = ensureAuthenticatedRequest(req);
  if (!authenticatedRequest.tokenHash) {
    sendFailure(res, 1003, 'Token无效或已过期');
    return;
  }
  await revokeSession(authenticatedRequest.tokenHash);
  sendSuccess(res, null);
}));

app.use('/api', (_req, res) => {
  sendFailure(res, 1001, '参数错误');
});

if (config.nodeEnv === 'production') {
  app.use(express.static(config.clientDistPath));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res, next) => {
    res.sendFile(path.join(config.clientDistPath, 'index.html'), (error) => {
      if (error) {
        next(error);
      }
    });
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ValidationError || (error instanceof SyntaxError && 'body' in error)) {
    sendFailure(res, 1001, '参数错误');
    return;
  }
  if (error instanceof BusinessError) {
    sendFailure(res, error.code, error.message);
    return;
  }
  console.error('Unhandled server error:', error instanceof Error ? error.message : error);
  res.status(500).json({ code: 9999, message: '系统异常', data: null });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`User dashboard server listening on http://127.0.0.1:${config.port}`);
});
