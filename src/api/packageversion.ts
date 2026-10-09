// 平台包版本矩阵（§9.10）：hub 的 GET /package-versions 端点。
// 返回 console / hub / runner 三个**部署时**版本（chart 从 versions.yaml 渲染进
// package-versions ConfigMap 注入 hub pod，dev 模式无 CM 时报 "dev"）。
// 无 DB 访问 —— 它是部署时常量，不是可变运行时状态。
import { http } from './http'

export interface PackageVersions {
  console: string
  hub: string
  runner: string
}

export const packageVersionApi = {
  get: () => http.get<{ data: PackageVersions }>('/package-versions').then((r) => r.data.data),
}
