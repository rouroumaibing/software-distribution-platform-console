// 资源索引：遍历服务树，把「Service / 组件 / 流水线」摊平成全局列表。
// 两个消费方共用这一次遍历结果：
//   1) 运行中心（`RunCenterView.vue`）—— 用 `pipelines` 当两个视图的数据源；
//   2) 全局搜索 ⌘K 浮层（`useGlobalSearch.ts`）—— 用 `services` / `components` / `pipelines` 当命中池。
//
// 为什么是前端聚合：hub 目前只有 GET /components/:id/pipelines（按组件列），
// 既没有 GET /pipelines?scope=global（设计文档 附 A N-3），也没有 §5.2/§5.3 写的
// 「服务端 GET /search」—— 两者均已在 UNIMPLEMENTED-MODULES-PLAN 登记为后端缺口。
// M1 数据量小（百级请求在本地库可接受）；等聚合端点落地后本文件可下线。
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
  /** 所属路径（组织 / 服务），搜索浮层展示用（§5.3 每行带所属路径）。 */
  orgName: string
  serviceName: string
}

export interface ServiceRef {
  serviceId: string
  serviceName: string
  serviceKey: string
  orgName: string
}

export interface ComponentRef {
  componentId: string
  componentName: string
  componentKey: string
  orgName: string
  serviceName: string
}

export interface ResourceIndex {
  /** 全服务树的流水线（按 组织 → 服务 → 组件 顺序摊平，可直接当列表用）。 */
  pipelines: PipelineRef[]
  /** 运行记录只带 pipelineId，展示时用它补组件/流水线名。 */
  byPipelineId: Map<string, PipelineRef>
  /** 搜索池：全部 Service。 */
  services: ServiceRef[]
  /** 搜索池：全部组件。 */
  components: ComponentRef[]
}

export function emptyResourceIndex(): ResourceIndex {
  return { pipelines: [], byPipelineId: new Map(), services: [], components: [] }
}

/** 单层拉取上限：与各页列表一致。M1 规模下够用；真超了要改成翻页遍历。 */
const PAGE = { page: 1, pageSize: 100 }

export async function buildResourceIndex(): Promise<ResourceIndex> {
  const pipelines: PipelineRef[] = []
  const services: ServiceRef[] = []
  const components: ComponentRef[] = []
  const byPipelineId = new Map<string, PipelineRef>()

  const orgs = await orgApi.list(PAGE)
  for (const o of orgs.items) {
    const tree = await orgApi.getServiceTree(o.id).catch(() => undefined)
    if (!tree) continue
    const svcPage = await catalogApi.listByServiceTree(tree.id, PAGE).catch(() => undefined)
    if (!svcPage) continue
    for (const s of svcPage.items) {
      services.push({ serviceId: s.id, serviceName: s.name, serviceKey: s.key, orgName: o.name })
      const comps = await componentApi.listByService(s.id, PAGE).catch(() => undefined)
      if (!comps) continue
      for (const c of comps.items) {
        components.push({
          componentId: c.id,
          componentName: c.name,
          componentKey: c.key,
          orgName: o.name,
          serviceName: s.name,
        })
        const pls = await pipelineApi.listByComponent(c.id, PAGE).catch(() => undefined)
        if (!pls) continue
        for (const p of pls.items) {
          const ref: PipelineRef = {
            pipelineId: p.id,
            pipelineName: p.name,
            componentId: c.id,
            componentName: c.name,
            kind: p.kind,
            version: p.version,
            orgName: o.name,
            serviceName: s.name,
          }
          pipelines.push(ref)
          byPipelineId.set(p.id, ref)
        }
      }
    }
  }

  return { pipelines, byPipelineId, services, components }
}
