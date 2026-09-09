// 资源索引：遍历服务树建 pipelineId → { componentName, pipelineName } 映射。
// 运行中心的全局 runs 只有 pipelineId，展示时用它补组件/流水线名。
// M1 数据量小（百级请求在本地库可接受）；后续 hub 出全局聚合端点后可下线。
import { orgApi } from '@/api/org'
import { catalogApi } from '@/api/catalog'
import { componentApi } from '@/api/component'
import { pipelineApi } from '@/api/pipeline'

export interface PipelineRef {
  componentName: string
  componentId: string
  pipelineName: string
}

export async function buildPipelineIndex(): Promise<Map<string, PipelineRef>> {
  const idx = new Map<string, PipelineRef>()
  const orgs = await orgApi.list({ page: 1, pageSize: 100 })
  for (const o of orgs.items) {
    const tree = await orgApi.getServiceTree(o.id).catch(() => undefined)
    if (!tree) continue
    const services = await catalogApi.listByServiceTree(tree.id, { page: 1, pageSize: 100 }).catch(() => undefined)
    if (!services) continue
    for (const s of services.items) {
      const comps = await componentApi.listByService(s.id, { page: 1, pageSize: 100 }).catch(() => undefined)
      if (!comps) continue
      for (const c of comps.items) {
        const pls = await pipelineApi.listByComponent(c.id, { page: 1, pageSize: 100 }).catch(() => undefined)
        if (!pls) continue
        for (const p of pls.items) {
          idx.set(p.id, { componentName: c.name, componentId: c.id, pipelineName: p.name })
        }
      }
    }
  }
  return idx
}
