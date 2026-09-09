import { z } from 'zod';

export class ValidationError extends Error {
  constructor() {
    super('参数错误');
    this.name = 'ValidationError';
  }
}

const username = z.string().regex(/^[A-Za-z0-9_]{4,20}$/);
const password = z.string().min(6).max(20);
const name = z.string().refine((value) => {
  const length = Array.from(value).length;
  return length >= 2 && length <= 20;
});
const mobile = z.string().regex(/^\d{11}$/);
const email = z.string().refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
const status = z.union([z.literal(0), z.literal(1)]);

export const loginSchema = z.object({ username, password }).strict();

export const createUserSchema = z.object({
  username,
  name,
  mobile,
  email: email.optional(),
  password,
  status
}).strict();

export const updateUserSchema = z.object({
  name,
  mobile,
  email: email.optional()
}).strict();

export const updateStatusSchema = z.object({ status }).strict();

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError();
  }
  return result.data;
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export interface UserListQuery {
  username?: string;
  mobile?: string;
  status?: 0 | 1;
  page: number;
  pageSize: 10 | 20 | 50;
}

export function parseUserListQuery(query: Record<string, unknown>): UserListQuery {
  const usernameValue = query.username;
  const mobileValue = query.mobile;
  const statusValue = query.status;
  const page = parseInteger(query.page);
  const pageSize = parseInteger(query.pageSize);

  if (usernameValue !== undefined && (typeof usernameValue !== 'string' || usernameValue.length > 20)) {
    throw new ValidationError();
  }
  if (mobileValue !== undefined && (typeof mobileValue !== 'string' || !/^\d{11}$/.test(mobileValue))) {
    throw new ValidationError();
  }
  if (statusValue !== undefined && statusValue !== '0' && statusValue !== '1') {
    throw new ValidationError();
  }
  if (!page || page < 1 || !pageSize || ![10, 20, 50].includes(pageSize)) {
    throw new ValidationError();
  }

  return {
    username: typeof usernameValue === 'string' && usernameValue !== '' ? usernameValue : undefined,
    mobile: typeof mobileValue === 'string' && mobileValue !== '' ? mobileValue : undefined,
    status: statusValue === undefined ? undefined : Number(statusValue) as 0 | 1,
    page,
    pageSize: pageSize as 10 | 20 | 50
  };
}

export function parseUserId(value: unknown): number {
  const id = parseInteger(value);
  if (!id || id < 1) {
    throw new ValidationError();
  }
  return id;
}
