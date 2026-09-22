import { http, type Envelope, type PagedData, type Pagination } from './http'

// 前端这边的 createCrud 对应的正是 hub 的 common.RegisterCRUD ——后端用泛型
// 把四个标准路由的 handler 收成一行,前端这里用同样的思路把四个标准请求收
// 成一个工厂函数,每个模块的 api/*.ts 不用重复写 axios 调用样板。
export function createCrud<T>(basePath: string) {
  return {
    create: (payload: Partial<T>) =>
      http.post<Envelope<T>>(basePath, payload).then((r) => r.data.data as T),

    get: (id: string) =>
      http.get<Envelope<T>>(`${basePath}/${id}`).then((r) => r.data.data as T),

    update: (id: string, payload: Partial<T>) =>
      http.put<Envelope<T>>(`${basePath}/${id}`, payload).then((r) => r.data.data as T),

    remove: (id: string) => http.delete(`${basePath}/${id}`),
  }
}

// 父级作用域的列表(比如某个 service 下的 components)每个模块的 scoping
// 方式不一样,这里只提供一个统一的分页参数拼接工具,具体调用还是各模块自己写。
// 额外查询参数(query)直接并入请求,用于 scope / scopeId 等非分页过滤。
export function listPaged<T>(path: string, pagination?: Pagination, query?: Record<string, unknown>) {
  return http
    .get<Envelope<PagedData<T>>>(path, { params: { ...(pagination ?? {}), ...(query ?? {}) } })
    .then((r) => r.data.data as PagedData<T>)
}
