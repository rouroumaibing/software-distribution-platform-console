# software-distribution-platform-console
软件发布平台前端。技术栈：vue3 + vite + TypeScript，包管理 pnpm。

## 本地开发 / 管理命令

管理命令入口为 `package.json` scripts（pnpm）；服务启停、清理的底层实现见 `scripts/`，`pnpm run` 可查看全部脚本。**本仓自包含：所有命令只依赖仓内脚本（`scripts/*.sh`、`build/console/build.sh`），不依赖仓库外的任何脚本** —— 起服务用 `pnpm start:dev`，产出镜像 / 交付包用 `pnpm image`。

**构建产物统一落在 `output/` 下**（vite 产物 `output/dist`、依赖预构建缓存 `output/.vite`、本地自签证书 `output/certs`、`pnpm image` 的交付产物），清理即一条 `rm -rf output`；仓库根不再产生 `dist/`。

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动本地 Vite 开发服务（裸 `vite`，前台运行） |
| `pnpm start:dev` | 托管启动本地开发服务（`scripts/svc.sh start`：pid 文件 + 进程组管理，启动前自动清理旧实例） |
| `pnpm stop:dev` | 停止本地开发服务（`scripts/svc.sh stop`，按 pid 文件 + 进程特征兜底清理） |
| `pnpm build` | 类型检查 + 生产构建：`vue-tsc --noEmit && vite build` → `output/dist/` |
| `pnpm typecheck` | 仅做 TS / Vue 类型检查（`vue-tsc --noEmit`） |
| `pnpm preview` | 本地预览生产构建（`vite preview`，服务于 `output/dist`） |
| `pnpm package` | Vite 生产构建（`vite build`，不带类型检查；与 `build` 的区别：仅产出静态资源） |
| `pnpm image` | 组件打包：`output/dist` → nginx 运行时镜像 + charts → 交付包 `output/software-distribution-platform-console-<version>.tar.gz`，并尝试推送到本地 registry（`build/console/build.sh`，默认版本 `v0.0.1`，可用 `pnpm image -- <version>` 指定） |
| `pnpm clean` | **先停本地开发服务**，再删生成物（`output/`，及历史位置 `dist/ .vite/ coverage/ .run/` 与散落单文件），保留下载依赖 node_modules（`scripts/clean.sh`） |
| `pnpm clean -- --no-stop` | 同上，但跳过停服务（CI / 无服务场景；也可用 `NO_STOP=1 pnpm clean`） |
| `pnpm clean:deep` | 删生成物 + 全部下载依赖（`node_modules/ .pnpm-store/`）（`scripts/clean.sh --deep`） |

## TLS 证书（交付契约 / 本地自签）

console 的 HTTPS 由**两个集群内 Secret** 承载，**镜像与交付包不携带任何证书或私钥**：

| Secret | 类型 | 必需 key | 消费方（容器内引用） |
| --- | --- | --- | --- |
| `console-tls` | `Opaque` | `ca.crt` `server.crt` `server.key` | chart 挂到 pod 内 `/etc/nginx/ssl`（`defaultMode 384`），nginx 443 监听使用。见 `build/console/charts/.../templates/deployment.yaml` |
| `console-ingress-tls` | `kubernetes.io/tls` | `tls.crt` `tls.key` | ingress 终结外部 HTTPS。见 `templates/ingress.yaml` |

- **生产环境：由运维手工创建这两个 Secret**（证书来自你自己的 PKI / CA），组件只在容器内引用 —— 与参考工程 `old/go-devops` 的做法一致（`chart` 只声明 `secretName`，部署流程不生成私钥）。示例：

  ```bash
  kubectl -n sdp-system create secret generic console-tls \
      --from-file=ca.crt=ca.crt --from-file=server.crt=server.crt --from-file=server.key=server.key
  kubectl -n sdp-system create secret tls console-ingress-tls --cert server.crt --key server.key
  ```

  Secret 名可改，改 `values.yaml` 的 `cert.secretName` / `ingress.tlsSecretName` 即可（两者是 chart 的引用入口）。
- **本地联调**：没有 PKI 时用仓内脚本 `scripts/gen-certs.sh` 自签兜底（临时测试用途，产物落 `output/certs`，随 `pnpm clean` 一起回收；私钥 `chmod 600`）。脚本默认会：生成 CA + server 证书 → `kubectl apply` 覆写上面两个 Secret（幂等；CA 文件已存在则复用，保证证书链一致）；运行前需已 `export KUBECONFIG`。
  - 只想拿到证书文件（集群没起 / 没有 kubectl）时加 `--local-only`：`bash scripts/gen-certs.sh --local-only` —— 只产出 `output/certs/{ca.crt,server.crt,server.key}`，不碰集群；集群可用后再跑一次**不带**该参数的脚本即可写入 Secret，或用上面的 `kubectl create secret` 手工创建。
  - 命名空间默认 `sdp-system`（可作首个位置参数覆盖）；产物目录可用 `CERTS_DIR` 覆盖。
  - ⚠️ 本脚本生成的 CA 是**本地自签的**：换机 / 重生成会让指纹变化，已经信任过旧 `ca.crt` 的浏览器需要重新信任。

## 设计文档

本组件的设计文档（UI 设计、IA 原型、实现 Story、验收标准等）已统一收敛到独立的 [`software-distribution-platform-docs`](https://github.com/rouroumaibing/software-distribution-platform-docs) 仓库（单一真源），本仓库不再存放设计文档正文。

- 前端设计文档（唯一事实源，IA v3）：[`console/CONSOLE-UI-DESIGN.md`](https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/console/CONSOLE-UI-DESIGN.md)
- IA v3 可交互原型：[`console/CONSOLE-UI-原型.html`](https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/console/CONSOLE-UI-原型.html)
- 跨组件对齐（整体目标 / 授权模型 G7 / 执行模型）：见 docs 仓库 [`README.md` §5](https://github.com/rouroumaibing/software-distribution-platform-docs/blob/main/README.md)

> 本仓库 `docs/design/README.md` 仅保留一个指针，指向上述统一文档库；设计文档的修改请在 docs 仓库进行。
