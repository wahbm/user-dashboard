export type UserStatus = 0 | 1;

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

export interface LoginData {
  token: string;
}

export interface UserListItem {
  id: number;
  username: string;
  name: string;
  mobile: string;
  email: string;
  status: UserStatus;
  createTime: string;
}

export interface UserListData {
  total: number;
  page: number;
  pageSize: number;
  list: UserListItem[];
}

export interface CreateUserData {
  id: number;
}

export interface CreateUserRequest {
  username: string;
  name: string;
  mobile: string;
  email?: string;
  password: string;
  status: UserStatus;
}

export interface UpdateUserRequest {
  name: string;
  mobile: string;
  email?: string;
}

export interface UpdateUserStatusRequest {
  status: UserStatus;
}
