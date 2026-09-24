import { http } from './http'
import type { Envelope, PagedData, Pagination } from './http'
import {
  credentialScopeLabel,
  credentialTypeLabel,
  type CredentialDTO,
  type CredentialInput,
  type CredentialScope,
  type CredentialType,
} from '@/utils/credential'

export type { CredentialDTO, CredentialInput, CredentialScope, CredentialType }
export { credentialTypeLabel, credentialScopeLabel }

export interface KubeParseResult {
  server: string
  caPresent: boolean
  insecureSkipTLS: boolean
  authMethod: string // token | client-cert | basic | none
  currentContext: string
  defaultNamespace: string
  errors: string[]
}

export const credentialApi = {
  list(scope?: CredentialScope, scopeId?: string, p?: Pagination) {
    return http
      .get<Envelope<PagedData<CredentialDTO>>>('/credentials', {
        params: { ...(scope ? { scope } : {}), ...(scopeId ? { scopeId } : {}), ...(p ?? {}) },
      })
      .then((r) => r.data.data as PagedData<CredentialDTO>)
  },
  get(id: string) {
    return http.get<Envelope<CredentialDTO>>(`/credentials/${id}`).then((r) => r.data.data as CredentialDTO)
  },
  // 创建：value 明文随请求上送，hub 落库前用 AES-GCM 信封加密（internal/credentials/codec）。
  create(body: CredentialInput) {
    return http.post<Envelope<CredentialDTO>>('/credentials', body).then((r) => r.data.data as CredentialDTO)
  },
  update(id: string, body: CredentialInput) {
    return http.put<Envelope<CredentialDTO>>(`/credentials/${id}`, body).then((r) => r.data.data as CredentialDTO)
  },
  remove(id: string) {
    return http.delete(`/credentials/${id}`)
  },
  // 结构性 kubeconfig 预览（权威校验仍在 hub 侧；hub 无 client-go，仅做文本/结构解析）。
  parseKubeconfig(raw: string) {
    return http
      .post<Envelope<KubeParseResult>>('/credentials/parse-kubeconfig', { raw })
      .then((r) => r.data.data as KubeParseResult)
  },
}
