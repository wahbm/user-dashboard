# 项目上下文

## 目标

提供一个可部署到阿里云 ECS 的后台用户管理系统：管理员登录后完成普通用户的查询、分页、新增、编辑、启用/禁用和密码重置。普通用户业务登录不在本期范围内。

## 当前状态

- 一期功能、接口、生产部署和手动验收已完成；当前 `main` 为已部署基线。本工作树另有尚未发布的幂等补强和测试 Agent 说明文档改动。
- 线上入口：`https://8.130.116.192/ww/user-dashboard/`，不绑定域名，不启用自动备份。
- 默认管理员：`admin / 123456`。
- 普通用户初始为空；`server/sql/001_init.sql` 当前会初始化四张表。幂等补强尚未发布到线上，下一次部署必须先执行迁移以创建 `admin_idempotency_keys`。

## 技术栈

- 前端：React 19、TypeScript、Vite 6、Ant Design 5、Axios、React Router DOM 7。
- 后端：Node.js、Express、TypeScript、Zod、`mysql2/promise`、`bcryptjs`、`dotenv`、CORS、`swagger-ui-express`。
- 数据库：MariaDB 10.11，`utf8mb4`，独立 schema `user_dashboard`。
- 部署：GitHub Actions、阿里云 ECS、Nginx、systemd；应用发布采用不可变 release + `current` symlink，失败回滚到上一版本。

## 目录结构

```text
client/                 React 页面、API 客户端、运行时路径和样式
server/src/             Express 路由、认证、校验、数据库访问和迁移入口
server/sql/             幂等 SQL 初始化脚本
shared/                 前后端共享类型/构建包
deploy/                 ECS 的 systemd、Nginx、sudoers 和发布脚本
.github/workflows/      ECS 部署工作流
docs/                   AI 接手所需的项目、架构和 TODO 文档
```

## 已完成模块

- `/login`：管理员登录、表单校验、Token 保存和失效跳转。
- `/user/list`：用户名模糊查询、手机号精确查询、状态筛选、10/20/50 分页、新增、编辑、状态切换、重置密码、退出登录。
- 写操作幂等：前端为新增、编辑、状态切换和重置密码生成 `Idempotency-Key`；服务端持久化请求摘要并回放重复请求响应。退出登录依赖 Token 吊销，未纳入幂等回放。
- `/api-docs/`：OpenAPI 3.0.3 Swagger UI；线上位于 `/ww/user-dashboard/api-docs/`，支持用登录 Token 调试受保护接口。
- API：`POST /api/login`、`GET/POST /api/users`、`PUT/PATCH /api/users/{id}`、`POST /api/users/{id}/reset-password`、`POST /api/logout`。
- 认证：Token 为随机 opaque token，数据库只保存 SHA-256 摘要；支持 24 小时默认过期和服务端吊销。
- 数据：`admin_accounts`、`users`、`admin_sessions`；管理员与普通用户隔离，用户 ID 从 `10001` 自增。
- 生产：Node 私有监听 `127.0.0.1:3100`，Nginx 处理 `/ww/user-dashboard/` 前缀，MariaDB 不暴露公网 3306。

## 关键决策

- 接口统一返回 `{ code, message, data }`，保留文档业务码 `0`、`1001`、`1002`、`1003`、`2001`、`2002`、`2003`、`2004`、`9999`。
- 除登录外的 API 必须使用 `Authorization: Bearer {token}`；前端收到 `1003` 会清除本地凭据并跳转登录页。
- 密码只保存哈希；新增用户默认启用，编辑不允许修改用户名和初始密码。
- `server/src/migrate.ts` 使用 `CREATE TABLE IF NOT EXISTS` 和幂等管理员插入；生产应用账号目前同时承担运行和迁移，未来若拆分账号必须同步调整发布流程。
- 新增/编辑表单提交期间按钮进入 loading 且不可重复提交；接口层仍以 `Idempotency-Key` 作为最终幂等保障。
- 生产环境变量位于 ECS `/var/www/ww/user-dashboard/shared/app.env`，不提交真实凭据；当前使用已有的 IP HTTPS 证书。

## 运行与验证

```bash
npm install
cp .env.example .env
npm run db:migrate       # 需要本机 MariaDB 和 .env 数据库配置
npm run dev              # 前端 Vite + 后端开发服务
npm run build            # shared、client、server 构建
npm start                # 生产模式启动后端
bash -n deploy/activate-release.sh
```

本轮未新增自动化测试；部署工作流执行构建并验证公开页面/API。修改接口或部署配置后，至少重新运行构建、脚本语法检查和手动登录/用户管理验收。
