# AI 协作约定

本仓库是已部署的后台用户管理系统。开始修改前先阅读 `README.md`、`docs/PROJECT_CONTEXT.md`、`docs/ARCHITECTURE.md` 和 `docs/TODO.md`，并检查 `git status`，不要覆盖或丢弃既有未提交改动。

## 不可随意改变的约束

- 默认管理员必须是 `admin / 123456`；`admin / admin123` 不是本项目默认凭据。管理员存于 `admin_accounts`，不能出现在普通用户列表中。
- 保持接口路径、统一响应结构、业务码和鉴权约定；详见 `docs/ARCHITECTURE.md`。
- 除登录和退出登录外的受保护写接口必须携带 `Idempotency-Key`；同一 key 不得复用到不同请求，服务端幂等记录由迁移脚本维护。
- 用户 ID 从 `10001` 起，用户名和手机号唯一，列表按创建时间倒序；重置密码固定为 `Aa123456`，除非需求明确变更。
- 前端部署前缀当前为 `/ww/user-dashboard/`，必须同时与 Vite、React Router、Axios 和 Nginx 配置保持一致。
- 生产 Node 服务仅监听 `127.0.0.1:3100`，MariaDB 仅本机访问；不要把 3306、数据库密码、SSH 私钥或 Actions secret 写入仓库。
- 当前不绑定域名、不配置自动备份；要改变这两项必须同步更新部署配置和文档。

## 工作约定

- 先做增量修改并按比例验证；不要使用破坏性 git 操作。
- 提交或部署前，如果运行方式、接口、基础设施或安全边界发生变化，先更新相关文档；文档未更新时应向用户确认。
- 创建 PR 时直接创建正式 PR，不创建 draft。若 `gh` token 失效，检查沙箱权限后再重试一次。
- 不要为了“补齐”而新增本期未定义的普通用户登录、删除用户或测试体系。

## 常用命令

```bash
npm install
npm run dev
npm run build
npm run db:migrate
npm start
bash -n deploy/activate-release.sh
```
