import type { Response } from 'express';
import type { ApiResponse } from '@user-dashboard/shared';

export function sendSuccess<T>(res: Response, data: T, message = 'success') {
  const body: ApiResponse<T> = { code: 0, message, data };
  return res.status(200).json(body);
}

export function sendFailure(res: Response, code: number, message: string) {
  const body: ApiResponse<null> = { code, message, data: null };
  return res.status(200).json(body);
}
