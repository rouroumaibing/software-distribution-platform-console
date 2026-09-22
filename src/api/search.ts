// 服务端搜索（hub `GET /search`）的客户端封装。
//
// 契约来源：CONSOLE-UI-DESIGN.md §5.3 全局搜索 / §4.1 服务端搜索 / 附 A N-8。
// 后端返回 `{type,name,path,id}`，前端既有的命中模型是 `SearchHit{kind,...}` ——
// 翻译在 `utils/search.hitFromDto`（放那里是因为它是纯函数，能被 node 直接 import
// 做冒烟断言；本文件一被 import 就会牵出 axios 与 pinia store）。
import { http } from './http'
import { hitFromDto, type SearchHit, type SearchHitDto, type SearchKind } from '@/utils/search'

export type { SearchHitDto }

export interface SearchQuery {
  q: string
  /** 省略 = 三类全搜。 */
  types?: SearchKind[]
  /** 每类各取条数（后端上限 50）。 */
  limit?: number
}

export const searchApi = {
  async query({ q, types, limit }: SearchQuery): Promise<SearchHit[]> {
    const params: Record<string, string | number> = { q }
    if (types && types.length > 0) params.type = types.join(',')
    if (limit && limit > 0) params.limit = limit
    const res = await http.get<{ data: SearchHitDto[] }>('/search', { params })
    const rows = res.data.data ?? []
    return rows.map(hitFromDto).filter((h): h is SearchHit => h !== undefined)
  },
}
