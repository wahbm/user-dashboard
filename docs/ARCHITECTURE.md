# 系统架构

## 运行拓扑

```text
浏览器
  -> Nginx: /ww/user-dashboard/
  -> Node/Express: 127.0.0.1:3100
  -> MariaDB: 127.0.0.1:3306/user_dashboard
```

公网只暴露 Nginx 的 80/443；Nginx 将部署前缀去掉后转发到 Express。Node 同时提供生产静态文件和 SPA fallback，因此 `/ww/user-dashboard/` 及其前端深链接都能刷新访问。

## 前端

- `client/src/runtime.ts` 统一计算 `BASE_URL`、React Router `basename`、API base URL 和带前缀的页面路径。
- Axios 客户端自动附加 Bearer Token；遇到业务码 `1003` 清除 localStorage 并跳转 `/ww/user-dashboard/login`。
- 页面只实现管理员登录和普通用户管理；Ant Design 负责表单、表格、分页、弹窗和反馈。
- 生产构建必须通过 `VITE_BASE_PATH=/ww/user-dashboard/` 生成正确的静态资源路径。

## 后端与接口

Swagger UI 挂载在 `/api-docs/`，OpenAPI JSON 位于 `/api-docs/openapi.json`，两者不经过管理员鉴权。文档接口根据 Nginx 注入的 `X-Forwarded-Prefix` 生成当前公网服务地址，因此线上入口为 `/ww/user-dashboard/api-docs/`；本地开发入口为 `/api-docs/`。Swagger 只描述接口，不改变业务路由。

除登录和退出登录外的受保护 `POST`、`PUT`、`PATCH` 写接口要求 `Idempotency-Key` 请求头。服务端在 `admin_idempotency_keys` 中按管理员、请求 key、请求摘要保存处理中/已完成状态；相同请求重试会回放原 HTTP 状态和响应体，不同请求复用同一 key 会返回 `1001`。

Express 路由约定如下：

| 方法 | 路径 | 作用 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/api/login` | 管理员登录 | 否 |
| GET | `/api/users` | 查询/分页用户 | Bearer |
| POST | `/api/users` | 新增用户 | Bearer |
| PUT | `/api/users/{id}` | 修改姓名、手机号、邮箱 | Bearer |
| PATCH | `/api/users/{id}/status` | 启用/禁用 | Bearer |
| POST | `/api/users/{id}/reset-password` | 重置为 `Aa123456` | Bearer |
| POST | `/api/logout` | 吊销当前 Token | Bearer |

所有响应使用 `{ code, message, data }`。当前码语义为：`1001` 参数错误、`1002` 登录失败、`1003` Token 无效/过期、`2001` 用户不存在、`2002` 用户名重复、`2003` 手机号重复、`2004` 管理员账号禁用、`9999` 系统异常。用户名为 4～20 位英文/数字/下划线，姓名为 2～20 个字符，手机号为 11 位数字且唯一，邮箱可空但填写时必须合法。不要把业务错误改成仅依赖 HTTP 状态码的前端契约。

## 数据与认证

- `admin_accounts`：管理员账号和 bcrypt 密码哈希；不参与普通用户查询。
- `users`：普通用户资料、状态和创建时间；`id` 从 `10001` 开始，用户名/手机号有唯一约束。
- `admin_sessions`：Token SHA-256 摘要、过期时间、吊销时间和管理员关联；原始 Token 只返回给登录客户端。
- `admin_idempotency_keys`：受保护写操作的请求 key、请求摘要和响应回放记录；记录保留 24 小时。
- `server/src/migrate.ts` 负责幂等初始化。修改表结构时必须考虑既有数据、重复执行和线上发布顺序。

## 发布链路

GitHub Actions 在 `main` 或手动触发时构建项目，将 release 上传到 ECS `/var/www/ww/user-dashboard/releases/`，执行数据库迁移，再切换 `current` 并重启 `user-dashboard.service`。公开 URL 校验失败时保留上一 release 并回滚 symlink；数据库迁移不会自动回滚。

## 修改边界

- 不要随意改变公网前缀、Nginx 转发规则、systemd 服务名 `user-dashboard.service`、私有端口 `3100`、数据库 schema 或发布目录。
- 不要将 Node 或 MariaDB 改为公网监听，也不要把凭据放进 `.env.example` 以外的版本控制文件。
- 修改 API 响应码、认证存储、用户 ID 起始值、默认凭据或重置密码前，必须先确认需求并同步更新前端、SQL、部署和上下文文档。
