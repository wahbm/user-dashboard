# 后台用户管理系统

基于 React + Express + MariaDB 的后台用户管理系统，覆盖需求文档中定义的管理员登录和用户管理功能。

面向后续 AI 接手的上下文见：[AGENTS.md](AGENTS.md)、[项目上下文](docs/PROJECT_CONTEXT.md)、[架构说明](docs/ARCHITECTURE.md) 和 [TODO](docs/TODO.md)。

## 默认管理员

- 用户名：`admin`
- 密码：`123456`

管理员账号存放在独立的 `admin_accounts` 表中，不显示在普通用户列表。

## 环境要求

- Node.js 20+
- MariaDB 10.5+（或兼容的 MySQL 8）

## 本地运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 创建数据库，并复制环境变量模板：

   ```sql
   CREATE DATABASE user_dashboard
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci;

   CREATE USER 'user_dashboard_app'@'127.0.0.1' IDENTIFIED BY 'change_me';
   GRANT ALL PRIVILEGES ON user_dashboard.* TO 'user_dashboard_app'@'127.0.0.1';
   ```

   本地初始化阶段需要该账号拥有建表权限；生产环境应将迁移账号与运行账号分离，并将运行账号收敛为最小权限。

   ```bash
   cp .env.example .env
   ```

   根据本机 MariaDB 修改 `.env` 中的 `DB_USER` 和 `DB_PASSWORD`。

3. 初始化表结构和默认管理员：

   ```bash
   npm run db:migrate
   ```

4. 启动前后端开发服务：

   ```bash
   npm run dev
   ```

   - 前端：<http://127.0.0.1:5173/login>
   - API：<http://127.0.0.1:3000/api>

## 生产构建

```bash
npm run build
NODE_ENV=production npm start
```

生产模式下 Express 会同时提供 `client/dist` 静态文件和 `/api` 接口，服务只监听 `127.0.0.1`，便于由 Nginx 反向代理。

构建到路径前缀时设置 `VITE_BASE_PATH`，例如：

```bash
VITE_BASE_PATH=/ww/user-dashboard/ npm run build
```

## API

实现以下接口：

- `POST /api/login`
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/{id}`
- `PATCH /api/users/{id}/status`
- `POST /api/users/{id}/reset-password`
- `POST /api/logout`

除登录接口外，请求必须携带：

```text
Authorization: Bearer {token}
```

所有接口返回统一的 `code`、`message`、`data` 结构。用户 ID 从 `10001` 开始，密码重置为 `Aa123456`。

## 阿里云 ECS 部署

当前部署目标为阿里云 ECS 公网 IP 的 HTTPS 路径：

- 访问地址：<https://8.130.116.192/ww/user-dashboard/>
- GitHub 仓库：<https://github.com/wahbm/user-dashboard>
- 发布分支：`main`；推送到 `main` 或手动触发工作流会自动部署
- 部署目录：`/var/www/ww/user-dashboard`
- Node 服务：`user-dashboard.service`，监听 `127.0.0.1:3100`
- Nginx：将 `/ww/user-dashboard/` 反向代理到 Node 服务，并保留 SPA 深链接
- 生产环境变量：`/var/www/ww/user-dashboard/shared/app.env`

当前不绑定域名，访问使用 ECS 稳定公网 IP 上已有的 HTTPS 证书；后续如更换域名，需要重新配置 Nginx 和证书。

生产环境复用 ECS 上的原生共享 MariaDB，使用独立的 `user_dashboard` schema 和本机最小权限账号 `user_dashboard_app`。MariaDB 仅绑定本机，3306 不对公网开放。数据库凭据只放在 ECS 环境文件中，不提交到仓库，也不会打包进发布包。

发布包由 GitHub Actions 在 `ubuntu-24.04` 上使用 Node.js 22 构建，上传到 `releases/<commit>-<run>-<attempt>/`，通过 `current` 符号链接原子切换，并保留当前版本和一个上一版本。发布前会执行幂等数据库初始化；应用登录校验失败时自动恢复到上一版本。数据库迁移不做自动回滚。

首次部署或更换 ECS 时，按 `deploy/` 中的 systemd、Nginx、sudoers 和环境变量模板完成一次主机初始化。不要把真实数据库密码、SSH 私钥或其他运行时密钥放入仓库。

本项目不包含自动化测试、性能测试或安全专项测试；部署工作流只负责构建、发布和基本 HTTP 验证。
