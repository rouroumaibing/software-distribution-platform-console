// 资源索引：遍历服务树建 pipelineId → { 组件名, 流水线名, kind } 映射，
// 同时把这棵树上的流水线摊平成一个全局列表 —— 运行中心的「流水线 / 发布」
// 两个视图用它当数据源。
//
// 为什么是前端聚合：hub 目前只有 GET /components/:id/pipelines（按组件列），
// 没有 GET /pipelines?scope=global（设计文档 附 A N-3 已登记为后端依赖）。
// M1 数据量小（百级请求在本地库可接受）；等全局聚合端点落地后本文件可下线。
import { orgApi } from '@/api/org'
import { catalogApi } from '@/api/catalog'
import { componentApi } from '@/api/component'
import { pipelineApi, type Pipeline } from '@/api/pipeline'

export interface PipelineRef {
  pipelineId: string
  pipelineName: string
  componentId: string
  componentName: string
  /** 运行中心的「发布」视图 = kind==='release' 的运行。 */
  kind: Pipeline['kind']
  version: number
}

export interface ResourceIndex {
  /** 全服务树的流水线（按 组织 → 服务 → 组件 顺序摊平，可直接当列表用）。 */
  pipelines: PipelineRef[]
  /** 运行记录只带 pipelineId，展示时用它补组件/流水线名。 */
  byPipelineId: Map<string, PipelineRef>
}

export function emptyResourceIndex(): ResourceIndex {
  return { pipelines: [], byPipelineId: new Map() }
}

export async function buildResourceIndex(): Promise<ResourceIndex> {
  const pipelines: PipelineRef[] = []
  const byPipelineId = new Map<string, PipelineRef>()

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
          const ref: PipelineRef = {
            pipelineId: p.id,
            pipelineName: p.name,
            componentId: c.id,
            componentName: c.name,
            kind: p.kind,
            version: p.version,
          }
          pipelines.push(ref)
          byPipelineId.set(p.id, ref)
        }
      }
    }
  }

  return { pipelines, byPipelineId }
}
