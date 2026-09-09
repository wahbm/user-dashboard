import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  adminId?: number;
  tokenHash?: string;
}

export interface AdminAccountRow {
  id: number | string;
  username: string;
  password_hash: string;
  status: number;
}

export interface UserRow {
  id: number | string;
  username: string;
  name: string;
  mobile: string;
  email: string | null;
  status: number;
  createTime: string;
}
