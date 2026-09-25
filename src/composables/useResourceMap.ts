// 资源索引：把「Service / 组件 / 流水线」摊平成全局列表。
// 两个消费方共用这一次遍历结果：
//   1) 运行中心（`RunCenterView.vue`）—— 用 `pipelines` 当发布视图的 kind 过滤数据源；
//   2) 全局搜索 ⌘K 浮层（`useGlobalSearch.ts`）—— 用 `services` / `components` / `pipelines` 当命中池。
//
// 流水线已直连真端点：P0-2（hub GET /pipelines 全局列表）落地后，流水线不再走
// 「组织→服务→组件→流水线」四级遍历聚合，改为一次 `pipelineApi.listGlobal` 单次拉取
// （A 节：下线前端聚合 stopgap）。组件 / 服务仍需遍历以喂搜索池并补全流水线所属
// 组件名 / 组织名 / 服务名展示。
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

  // componentId → 名称/路径，流水线列表只带 componentId，展示名从这里补。
  const componentById = new Map<string, ComponentRef>()

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
        const ref: ComponentRef = {
          componentId: c.id,
          componentName: c.name,
          componentKey: c.key,
          orgName: o.name,
          serviceName: s.name,
        }
        components.push(ref)
        componentById.set(c.id, ref)
      }
    }
  }

  // A 节：流水线直连全局真端点，不再按组件嵌套遍历（下线前端聚合 stopgap）。
  const pls = await pipelineApi.listGlobal(PAGE).catch(() => undefined)
  for (const p of pls?.items ?? []) {
    const c = componentById.get(p.componentId)
    const ref: PipelineRef = {
      pipelineId: p.id,
      pipelineName: p.name,
      componentId: p.componentId,
      componentName: c?.componentName ?? '—',
      kind: p.kind,
      version: p.version,
      orgName: c?.orgName ?? '—',
      serviceName: c?.serviceName ?? '—',
    }
    pipelines.push(ref)
    byPipelineId.set(p.id, ref)
  }

  return { pipelines, byPipelineId, services, components }
}
