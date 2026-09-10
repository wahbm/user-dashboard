import type { Request } from 'express';

type Schema = Record<string, unknown>;
type Example = Record<string, unknown>;

const idempotencyKeyParameter: Schema = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  description: '本次写操作的唯一请求 ID。同一 key 重试同一请求会回放原响应。',
  schema: { type: 'string', minLength: 1, maxLength: 128 }
};

function apiResponseSchema(data: Schema): Schema {
  return {
    type: 'object',
    required: ['code', 'message', 'data'],
    properties: {
      code: {
        type: 'integer',
        description: '业务码。成功为 0；业务错误仍以 HTTP 200 返回。'
      },
      message: {
        type: 'string'
      },
      data
    }
  };
}

function apiResponse(
  data: Schema,
  examples: Record<string, { summary: string; value: Example }>,
  description = '业务响应（HTTP 200）'
): Schema {
  return {
    description,
    content: {
      'application/json': {
        schema: apiResponseSchema(data),
        examples
      }
    }
  };
}

function systemErrorResponse(): Schema {
  return {
    description: '系统异常',
    content: {
      'application/json': {
        schema: apiResponseSchema({ nullable: true }),
        example: {
          code: 9999,
          message: '系统异常',
          data: null
        }
      }
    }
  };
}

function bearerSecurity(): Array<Record<string, string[]>> {
  return [{ bearerAuth: [] }];
}

function forwardedPrefix(request: Request): string {
  const firstPrefix = request.get('X-Forwarded-Prefix')?.split(',')[0];
  const prefix = firstPrefix?.trim() ?? '';
  return prefix.replace(/\/+$/, '');
}

export function getOpenApiServerUrl(request: Request): string {
  return forwardedPrefix(request) || '/';
}

export function createOpenApiDocument(serverUrl: string): Schema {
  const nullData = {
    nullable: true,
    description: '成功时无业务数据'
  };

  return {
    openapi: '3.0.3',
    info: {
      title: '后台用户管理系统 API',
      version: '1.0.0',
      description:
        '管理员登录和普通用户管理接口。除登录外的接口需要 Authorization: Bearer {token}。业务错误使用 code 表达，HTTP 状态通常仍为 200。'
    },
    servers: [
      {
        url: serverUrl,
        description: serverUrl === '/' ? '当前后端地址' : '当前公网部署前缀'
      }
    ],
    tags: [
      { name: '认证', description: '管理员登录和会话管理' },
      { name: '用户管理', description: '普通用户查询和管理' }
    ],
    paths: {
      '/api/login': {
        post: {
          tags: ['认证'],
          summary: '管理员登录',
          operationId: 'login',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginRequest' },
                example: { username: 'admin', password: '123456' }
              }
            }
          },
          responses: {
            '200': apiResponse(
              { $ref: '#/components/schemas/LoginData' },
              {
                success: {
                  summary: '登录成功',
                  value: { code: 0, message: 'success', data: { token: 'opaque-token' } }
                },
                invalidCredentials: {
                  summary: '用户名或密码错误',
                  value: { code: 1002, message: '用户名或密码错误', data: null }
                },
                disabled: {
                  summary: '管理员账号已禁用',
                  value: { code: 2004, message: '当前账号已被禁用', data: null }
                }
              },
              '成功返回 Token；参数错误为 1001，登录失败为 1002，管理员禁用为 2004。'
            ),
            '500': systemErrorResponse()
          }
        }
      },
      '/api/users': {
        get: {
          tags: ['用户管理'],
          summary: '查询用户列表',
          operationId: 'listUsers',
          security: bearerSecurity(),
          parameters: [
            {
              name: 'username',
              in: 'query',
              description: '用户名模糊查询',
              schema: { type: 'string', maxLength: 20 }
            },
            {
              name: 'mobile',
              in: 'query',
              description: '手机号精确查询',
              schema: { type: 'string', pattern: '^\\d{11}$' }
            },
            {
              name: 'status',
              in: 'query',
              description: '用户状态：0 禁用，1 启用',
              schema: { type: 'integer', enum: [0, 1] }
            },
            {
              name: 'page',
              in: 'query',
              required: true,
              schema: { type: 'integer', minimum: 1, default: 1 }
            },
            {
              name: 'pageSize',
              in: 'query',
              required: true,
              schema: { type: 'integer', enum: [10, 20, 50], default: 10 }
            }
          ],
          responses: {
            '200': apiResponse(
              { $ref: '#/components/schemas/UserListData' },
              {
                success: {
                  summary: '查询成功',
                  value: {
                    code: 0,
                    message: 'success',
                    data: { total: 0, page: 1, pageSize: 10, list: [] }
                  }
                },
                invalidToken: {
                  summary: 'Token 无效或已过期',
                  value: { code: 1003, message: 'Token无效或已过期', data: null }
                }
              },
              '分页参数 page 必须大于等于 1，pageSize 只能为 10、20 或 50。'
            ),
            '500': systemErrorResponse()
          }
        },
        post: {
          tags: ['用户管理'],
          summary: '新增用户',
          operationId: 'createUser',
          security: bearerSecurity(),
          parameters: [idempotencyKeyParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateUserRequest' },
                example: {
                  username: 'user_001',
                  name: '测试用户',
                  mobile: '13800138000',
                  email: 'user@example.com',
                  password: 'Aa123456',
                  status: 1
                }
              }
            }
          },
          responses: {
            '200': apiResponse(
              { $ref: '#/components/schemas/CreateUserData' },
              {
                success: {
                  summary: '新增成功',
                  value: { code: 0, message: '新增成功', data: { id: 10001 } }
                },
                duplicateUsername: {
                  summary: '用户名已存在',
                  value: { code: 2002, message: '用户名已存在', data: null }
                },
                duplicateMobile: {
                  summary: '手机号已存在',
                  value: { code: 2003, message: '手机号已存在', data: null }
                }
              },
              '用户名重复为 2002，手机号重复为 2003，参数错误为 1001。新用户默认由前端传入启用状态 1。'
            ),
            '500': systemErrorResponse()
          }
        }
      },
      '/api/users/{id}': {
        put: {
          tags: ['用户管理'],
          summary: '编辑用户',
          operationId: 'updateUser',
          security: bearerSecurity(),
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
              description: '用户 ID'
            },
            idempotencyKeyParameter
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateUserRequest' },
                example: {
                  name: '更新用户',
                  mobile: '13900139000',
                  email: 'updated@example.com'
                }
              }
            }
          },
          responses: {
            '200': apiResponse(
              nullData,
              {
                success: {
                  summary: '修改成功',
                  value: { code: 0, message: '修改成功', data: null }
                },
                notFound: {
                  summary: '用户不存在',
                  value: { code: 2001, message: '用户不存在', data: null }
                },
                duplicateMobile: {
                  summary: '手机号已存在',
                  value: { code: 2003, message: '手机号已存在', data: null }
                }
              },
              '编辑只允许修改姓名、手机号和邮箱。'
            ),
            '500': systemErrorResponse()
          }
        }
      },
      '/api/users/{id}/status': {
        patch: {
          tags: ['用户管理'],
          summary: '启用或禁用用户',
          operationId: 'updateUserStatus',
          security: bearerSecurity(),
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
              description: '用户 ID'
            },
            idempotencyKeyParameter
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateUserStatusRequest' },
                example: { status: 0 }
              }
            }
          },
          responses: {
            '200': apiResponse(
              nullData,
              {
                success: {
                  summary: '操作成功',
                  value: { code: 0, message: '操作成功', data: null }
                },
                notFound: {
                  summary: '用户不存在',
                  value: { code: 2001, message: '用户不存在', data: null }
                }
              }
            ),
            '500': systemErrorResponse()
          }
        }
      },
      '/api/users/{id}/reset-password': {
        post: {
          tags: ['用户管理'],
          summary: '重置用户密码',
          operationId: 'resetUserPassword',
          security: bearerSecurity(),
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
              description: '用户 ID'
            },
            idempotencyKeyParameter
          ],
          responses: {
            '200': apiResponse(
              nullData,
              {
                success: {
                  summary: '密码重置成功',
                  value: { code: 0, message: '密码重置成功', data: null }
                },
                notFound: {
                  summary: '用户不存在',
                  value: { code: 2001, message: '用户不存在', data: null }
                }
              },
              '密码统一重置为 Aa123456。'
            ),
            '500': systemErrorResponse()
          }
        }
      },
      '/api/logout': {
        post: {
          tags: ['认证'],
          summary: '退出登录',
          operationId: 'logout',
          security: bearerSecurity(),
          responses: {
            '200': apiResponse(
              nullData,
              {
                success: {
                  summary: '退出成功',
                  value: { code: 0, message: 'success', data: null }
                },
                invalidToken: {
                  summary: 'Token 无效或已过期',
                  value: { code: 1003, message: 'Token无效或已过期', data: null }
                }
              },
              '服务端吊销当前 Token。'
            ),
            '500': systemErrorResponse()
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque-token',
          description: '先调用 POST /api/login 获取 token，再点击 Authorize 填入 token。'
        }
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              minLength: 4,
              maxLength: 20,
              pattern: '^[A-Za-z0-9_]{4,20}$'
            },
            password: { type: 'string', minLength: 6, maxLength: 20 }
          }
        },
        LoginData: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string' } }
        },
        CreateUserRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['username', 'name', 'mobile', 'password', 'status'],
          properties: {
            username: {
              type: 'string',
              minLength: 4,
              maxLength: 20,
              pattern: '^[A-Za-z0-9_]{4,20}$'
            },
            name: { type: 'string', minLength: 2, maxLength: 20 },
            mobile: { type: 'string', pattern: '^\\d{11}$' },
            email: {
              oneOf: [
                { type: 'string', format: 'email' },
                { type: 'string', maxLength: 0, description: '允许为空字符串' }
              ]
            },
            password: { type: 'string', minLength: 6, maxLength: 20 },
            status: { type: 'integer', enum: [0, 1], default: 1 }
          }
        },
        UpdateUserRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'mobile'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 20 },
            mobile: { type: 'string', pattern: '^\\d{11}$' },
            email: {
              oneOf: [
                { type: 'string', format: 'email' },
                { type: 'string', maxLength: 0, description: '允许为空字符串' }
              ]
            }
          }
        },
        UpdateUserStatusRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: {
            status: { type: 'integer', enum: [0, 1] }
          }
        },
        User: {
          type: 'object',
          required: ['id', 'username', 'name', 'mobile', 'email', 'status', 'createTime'],
          properties: {
            id: { type: 'integer', minimum: 10001 },
            username: { type: 'string' },
            name: { type: 'string' },
            mobile: { type: 'string' },
            email: { type: 'string' },
            status: { type: 'integer', enum: [0, 1] },
            createTime: { type: 'string', example: '2026-01-01 12:00:00' }
          }
        },
        UserListData: {
          type: 'object',
          required: ['total', 'page', 'pageSize', 'list'],
          properties: {
            total: { type: 'integer', minimum: 0 },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', enum: [10, 20, 50] },
            list: {
              type: 'array',
              items: { $ref: '#/components/schemas/User' }
            }
          }
        },
        CreateUserData: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer', minimum: 10001 } }
        }
      }
    }
  };
}
