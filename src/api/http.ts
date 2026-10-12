import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

// API baseURL 与认证配置同机制运行时注入（config.js / window.__APP_CONFIG__），
// 构建期变量仅作 dev 兜底；最终兜底 '/api/v1'：dev 走 vite proxy(/api)，
// 生产由 nginx /api 反代到 hub。空串同样视为未配置，避免部署漏配时
// axios 用相对路径把 /orgs 打到静态层（GET 得到 index.html、POST 405）。
const runtimeBase = (window as unknown as { __APP_CONFIG__?: Record<string, string> }).__APP_CONFIG__?.VITE_API_BASE_URL
export const http = axios.create({
  baseURL: runtimeBase || import.meta.env.VITE_API_BASE_URL || '/api/v1',
})

http.interceptors.request.use((config) => {
  const auth = useAuthStore()
  if (auth.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`
  }
  return config
})

// 403 统一出口（STATUS #21 / §7.9「权限不足错误态」）：非 200 响应里只有
// 403 语义全局一致 —— 「该账号没有这条资源的权限」，与具体表单无关，所以
// 拦截器直接跳 Forbidden 页；400/404/409 仍由调用方 catch 就地呈现。
// 两个豁免口，防止把「故意探测权限」的调用也踢走：
//   ① 单请求豁免：config 传 skip403Redirect: true（如权限探测、批量探测）；
//   ② 已在 /forbidden 时不重复跳（防循环）。
// 401 不在这里处理：会话过期由 auth store 的 token 刷新/登出流程负责。
declare module 'axios' {
  // 挂在 AxiosRequestConfig（InternalAxiosRequestConfig 的父接口）上，
  // 让调用方在请求 config 里直接传 skip403Redirect 而不报 TS2353。
  export interface AxiosRequestConfig {
    skip403Redirect?: boolean
  }
}
http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 403 &&
      !error.config?.skip403Redirect &&
      window.location.pathname !== '/forbidden'
    ) {
      window.location.assign('/forbidden')
    }
    return Promise.reject(error)
  },
)

// isAxiosStatus 判定「这个 rejection 是不是后端返回的该 HTTP 状态码」。
// 供 skip403Redirect 豁免口（auditApi.listForComponent 等）在调用方内联
// 呈现权限态，而不是让拦截器全局跳转。
export function isAxiosStatus(e: unknown, status: number): boolean {
  return axios.isAxiosError(e) && e.response?.status === status
}

// 后端统一响应格式:{ data?, error? } 或分页的 { data: { items, total, page, pageSize } }
export interface Envelope<T> {
  data?: T
  error?: string
}

export interface PagedData<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Pagination {
  page?: number
  pageSize?: number
}
