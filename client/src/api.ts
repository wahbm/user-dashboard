import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { message } from 'antd';
import type {
  ApiResponse,
  CreateUserData,
  CreateUserRequest,
  LoginData,
  UpdateUserRequest,
  UpdateUserStatusRequest,
  UserListData,
  UserStatus
} from '@user-dashboard/shared';
import { clearToken, getToken } from './auth';
import { apiBaseUrl, appPath } from './runtime';

export class ApiError extends Error {
  constructor(public readonly code: number, messageText: string) {
    super(messageText);
    this.name = 'ApiError';
  }
}

const http: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json'
  }
});

function mutationConfig(idempotencyKey: string) {
  return { headers: { 'Idempotency-Key': idempotencyKey } };
}

http.interceptors.request.use((request) => {
  const token = getToken();
  if (token) {
    request.headers.Authorization = `Bearer ${token}`;
  }
  return request;
});

http.interceptors.response.use((response) => {
  const body = response.data as ApiResponse<unknown> | undefined;
  if (body?.code === 1003) {
    clearToken();
    const loginPath = appPath('/login');
    if (window.location.pathname !== loginPath) {
      message.error(body.message);
      window.location.assign(loginPath);
    }
  }
  return response;
});

async function unwrap<T>(request: Promise<AxiosResponse<ApiResponse<T>>>): Promise<T> {
  try {
    const response = await request;
    const body = response.data;
    if (body.code !== 0) {
      throw new ApiError(body.code, body.message);
    }
    return body.data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (axios.isAxiosError(error)) {
      const responseBody = error.response?.data as ApiResponse<unknown> | undefined;
      throw new ApiError(responseBody?.code ?? 9999, responseBody?.message ?? '系统异常');
    }
    throw error;
  }
}

export function login(username: string, password: string): Promise<LoginData> {
  return unwrap<LoginData>(http.post('/login', { username, password }));
}

export interface UserListParams {
  username?: string;
  mobile?: string;
  status?: UserStatus;
  page: number;
  pageSize: 10 | 20 | 50;
}

export function listUsers(params: UserListParams): Promise<UserListData> {
  return unwrap<UserListData>(http.get('/users', { params }));
}

export function createUser(payload: CreateUserRequest, idempotencyKey: string): Promise<CreateUserData> {
  return unwrap<CreateUserData>(http.post('/users', payload, mutationConfig(idempotencyKey)));
}

export function updateUser(id: number, payload: UpdateUserRequest, idempotencyKey: string): Promise<null> {
  return unwrap<null>(http.put(`/users/${id}`, payload, mutationConfig(idempotencyKey)));
}

export function updateUserStatus(
  id: number,
  payload: UpdateUserStatusRequest,
  idempotencyKey: string
): Promise<null> {
  return unwrap<null>(http.patch(`/users/${id}/status`, payload, mutationConfig(idempotencyKey)));
}

export function resetUserPassword(id: number, idempotencyKey: string): Promise<null> {
  return unwrap<null>(http.post(`/users/${id}/reset-password`, undefined, mutationConfig(idempotencyKey)));
}

export function logout(): Promise<null> {
  return unwrap<null>(http.post('/logout'));
}
