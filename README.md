# software-distribution-platform-console
软件发布平台前端。技术栈：vue3 + vite + TypeScript，包管理 pnpm。

## 本地开发 / 管理命令

管理命令入口为 `package.json` scripts（pnpm）；服务启停、清理的底层实现见 `scripts/`，`pnpm run` 可查看全部脚本。

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动本地 Vite 开发服务（裸 `vite`，前台运行） |
| `pnpm start:dev` | 托管启动本地开发服务（`scripts/svc.sh start`：pid 文件 + 进程组管理，启动前自动清理旧实例） |
| `pnpm stop:dev` | 停止本地开发服务（`scripts/svc.sh stop`，按 pid 文件 + 进程特征兜底清理） |
| `pnpm build` | 类型检查 + 生产构建：`vue-tsc --noEmit && vite build` → `dist/` |
| `pnpm typecheck` | 仅做 TS / Vue 类型检查（`vue-tsc --noEmit`） |
| `pnpm preview` | 本地预览 `dist/` 生产构建（`vite preview`） |
| `pnpm package` | Vite 生产构建（`vite build`，不带类型检查；与 `build` 的区别：仅产出静态资源） |
| `pnpm image` | 组件打包：dist → nginx 运行时镜像 + charts → 交付包 `output/software-distribution-platform-console-<version>.tar.gz`，并尝试推送到本地 registry（`build/console/build.sh`，默认版本 `v0.0.1`，可用 `pnpm image -- <version>` 指定） |
| `pnpm clean` | 仅删生成物（`dist/ .vite/ coverage/ .run/ output/` 及散落单文件），保留下载依赖 node_modules（`scripts/clean.sh`） |
| `pnpm clean:deep` | 删生成物 + 全部下载依赖（`node_modules/ .pnpm-store/`）（`scripts/clean.sh --deep`） |
| `pnpm start:deploy` | 本地全量部署（调用工作区根 `deploy-local.sh`：kind + helm 交付形态） |
| `pnpm stop:deploy` | 本地全量卸载（调用工作区根 `undeploy-local.sh`，保留 kind 集群） |

## 设计文档

本组件的设计文档（UI 设计、IA 原型、实现 Story、验收标准等）已统一收敛到独立的 [`software-distribution-platform-docs`](https://github.com/rouroumaibing/software-distribution-platform-docs) 仓库（单一真源），本仓库不再存放设计文档正文。

- 前端设计文档：[`console/CONSOLE-UI设计文档.md`](https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/console/CONSOLE-UI设计文档.md)
- IA v2 交互原型：[`console/console-ia-v2-prototype.html`](https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/console/console-ia-v2-prototype.html)
- 跨组件对齐（整体目标 / 授权模型 G7 / 执行模型）：见 docs 仓库 [`README.md` §5](https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/README.md)

> 本仓库 `docs/design/README.md` 仅保留一个指针，指向上述统一文档库；设计文档的修改请在 docs 仓库进行。
