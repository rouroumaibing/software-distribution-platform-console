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
