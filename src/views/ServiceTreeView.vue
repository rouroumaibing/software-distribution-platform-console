<script setup lang="ts">
// 服务树页(CONSOLE-LAYOUT §3.2)：master-detail，页内 300px 树面板 + 右侧详情。
// 层级：Org → ServiceTree → Service → Component。
// 创建主干（参照 old ServiceTreeManage 的"树+节点添加对话框"模式）：
//   无组织 → 创建组织(自动 1:1 服务树)；选中树根 → 添加服务；选中服务 → 添加组件。
import { onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Modal from '@/components/Modal.vue'
import { orgApi, type Org, type ServiceTree } from '@/api/org'
import { catalogApi, type Service } from '@/api/catalog'
import { componentApi, type Component } from '@/api/component'
import { toast } from '@/utils/toast'

const router = useRouter()

interface TreeNode {
  id: string
  name: string
  kind: 'tree' | 'service' | 'component'
  service?: Service
  component?: Component
  children: TreeNode[]
  expanded: boolean
}

const orgs = ref<Org[]>([])
const orgId = ref('')
const treeInfo = ref<ServiceTree>()
const roots = ref<TreeNode[]>([])
const query = ref('')
const loading = ref(false)
const selected = ref<TreeNode>()

// ---- 创建对话框状态 ----
const orgDialog = ref(false)
const orgCreating = ref(false)
const orgForm = ref({ name: '', slug: '' })

const serviceDialog = ref(false)
const serviceCreating = ref(false)
const serviceForm = ref({ key: '', name: '', ownerTeam: '', description: '' })

const compDialog = ref(false)
const compCreating = ref(false)
const compForm = ref({ key: '', name: '', repoUrl: '', defaultBranch: 'main', language: '', description: '' })

onMounted(async () => {
  const p = await orgApi.list({ page: 1, pageSize: 100 })
  orgs.value = p.items
  if (orgs.value.length > 0) {
    orgId.value = orgs.value[0].id
    await load()
  }
})

async function load() {
  if (!orgId.value) return
  loading.value = true
  roots.value = []
  selected.value = undefined
  try {
    treeInfo.value = await orgApi.getServiceTree(orgId.value)
    const root: TreeNode = {
      id: treeInfo.value.id,
      name: treeInfo.value.name,
      kind: 'tree',
      children: [],
      expanded: true,
    }
    const services = await catalogApi.listByServiceTree(treeInfo.value.id, { page: 1, pageSize: 100 })
    for (const s of services.items) {
      const sNode: TreeNode = { id: s.id, name: s.name, kind: 'service', service: s, children: [], expanded: true }
      const comps = await componentApi.listByService(s.id, { page: 1, pageSize: 100 })
      for (const c of comps.items) {
        sNode.children.push({ id: c.id, name: c.name, kind: 'component', component: c, children: [], expanded: false })
      }
      root.children.push(sNode)
    }
    roots.value = [root]
    selected.value = root
  } finally {
    loading.value = false
  }
}

async function createOrg() {
  if (!orgForm.value.name.trim() || !orgForm.value.slug.trim()) {
    toast.err('组织名称与标识（slug）均必填')
    return
  }
  orgCreating.value = true
  try {
    const org = await orgApi.create({ name: orgForm.value.name.trim(), slug: orgForm.value.slug.trim() })
    toast.ok(`组织「${org.name}」已创建（服务树自动生成）`)
    orgDialog.value = false
    const p = await orgApi.list({ page: 1, pageSize: 100 })
    orgs.value = p.items
    orgId.value = org.id
    await load()
  } catch (e: any) {
    toast.err('创建失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    orgCreating.value = false
  }
}

async function createService() {
  if (!treeInfo.value) return
  if (!serviceForm.value.key.trim() || !serviceForm.value.name.trim()) {
    toast.err('服务 Key 与名称必填')
    return
  }
  serviceCreating.value = true
  try {
    const s = await catalogApi.create({
      serviceTreeId: treeInfo.value.id,
      key: serviceForm.value.key.trim(),
      name: serviceForm.value.name.trim(),
      ownerTeam: serviceForm.value.ownerTeam.trim() || undefined,
      description: serviceForm.value.description.trim() || undefined,
    })
    toast.ok(`服务「${s.name}」已创建`)
    serviceDialog.value = false
    await load()
    selected.value = roots.value[0]?.children.find((n) => n.id === s.id)
  } catch (e: any) {
    toast.err('创建失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    serviceCreating.value = false
  }
}

async function createComponent() {
  const svc = selected.value?.service
  if (!svc) return
  if (!compForm.value.key.trim() || !compForm.value.name.trim() || !compForm.value.repoUrl.trim()) {
    toast.err('组件 Key、名称与仓库地址必填')
    return
  }
  compCreating.value = true
  try {
    const c = await componentApi.create({
      serviceId: svc.id,
      key: compForm.value.key.trim(),
      name: compForm.value.name.trim(),
      repoUrl: compForm.value.repoUrl.trim(),
      defaultBranch: compForm.value.defaultBranch.trim() || 'main',
      language: compForm.value.language.trim() || undefined,
      description: compForm.value.description.trim() || undefined,
    })
    toast.ok(`组件「${c.name}」已创建`)
    compDialog.value = false
    await load()
    const svcNode = roots.value[0]?.children.find((n) => n.id === svc.id)
    selected.value = svcNode?.children.find((n) => n.id === c.id)
  } catch (e: any) {
    toast.err('创建失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    compCreating.value = false
  }
}

function matches(node: TreeNode, q: string): boolean {
  if (node.name.toLowerCase().includes(q.toLowerCase())) return true
  return node.children.some((c) => matches(c, q))
}

const visibleRoots = computed(() => {
  const q = query.value.trim()
  if (!q) return roots.value
  return roots.value.filter((n) => matches(n, q))
})

function select(n: TreeNode) {
  selected.value = n
}

function goComponent(c: Component) {
  router.push(`/components/${c.id}`)
}
</script>

<template>
  <div>
    <div class="page-head">
      <div class="crumb"><b>服务树</b></div>
      <div class="toolbar" style="margin-top: 0">
        <select v-model="orgId" class="select" style="width: auto" @change="load">
          <option v-for="o in orgs" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <button v-if="orgs.length > 0" class="btn btn-pearl btn-sm" @click="orgDialog = true">＋ 创建组织</button>
      </div>
    </div>

    <div v-if="orgs.length === 0" class="card empty" style="padding: 48px 0">
      <p style="margin-bottom: 16px">还没有组织。组织是服务树的根，创建后会自动生成 1:1 的服务树。</p>
      <button class="btn btn-primary" @click="orgDialog = true">＋ 创建第一个组织</button>
    </div>

    <div v-else class="md">
      <!-- 树面板 -->
      <div class="card tree-panel">
        <input v-model="query" class="input" placeholder="🔍 搜索节点" />
        <div v-if="loading" class="loading">加载中…</div>
        <div v-else-if="visibleRoots.length === 0" class="empty">暂无服务数据</div>
        <template v-else>
          <div v-for="root in visibleRoots" :key="root.id">
            <div class="tnode" :class="{ sel: selected?.id === root.id }" @click="select(root)">
              <span class="caret">▾</span>{{ root.name }}
            </div>
            <template v-if="root.expanded">
              <div v-for="s in root.children" :key="s.id">
                <div class="tnode l1" :class="{ sel: selected?.id === s.id }" @click="select(s)">
                  <span class="caret">▾</span>{{ s.name }}
                  <span class="count">{{ s.children.length }}</span>
                </div>
                <template v-if="s.expanded">
                  <div
                    v-for="c in s.children"
                    :key="c.id"
                    class="tnode l2"
                    :class="{ sel: selected?.id === c.id }"
                    :title="'打开组件详情'"
                    @click="goComponent(c.component!)"
                  >
                    ◦ {{ c.name }}
                  </div>
                </template>
              </div>
            </template>
          </div>
        </template>
      </div>

      <!-- 详情面板 -->
      <div class="card detail-panel">
        <template v-if="selected">
          <h3 style="font-size: 17px; margin-bottom: 12px">{{ selected.name }} 详情</h3>
          <template v-if="selected.kind === 'tree'">
            <p class="sub">服务树根节点 · 包含 {{ selected.children.length }} 个服务</p>
            <div class="kv-list">
              <div class="row"><span>ID</span><span class="mono">{{ selected.id }}</span></div>
              <div class="row"><span>服务数</span><span>{{ selected.children.length }}</span></div>
            </div>
            <div class="toolbar">
              <button class="btn btn-primary btn-sm" @click="serviceDialog = true">＋ 添加服务</button>
            </div>
          </template>
          <template v-else-if="selected.kind === 'service' && selected.service">
            <div class="kv-list">
              <div class="row"><span>Key</span><span class="mono">{{ selected.service.key }}</span></div>
              <div class="row"><span>负责人团队</span><span>{{ selected.service.ownerTeam || '—' }}</span></div>
              <div class="row"><span>描述</span><span>{{ selected.service.description || '—' }}</span></div>
              <div class="row"><span>组件数</span><span>{{ selected.children.length }}</span></div>
            </div>
            <div class="toolbar">
              <button class="btn btn-primary btn-sm" @click="compDialog = true">＋ 添加组件</button>
            </div>
          </template>
          <template v-else-if="selected.kind === 'component' && selected.component">
            <div class="kv-list">
              <div class="row"><span>仓库</span><span class="mono">{{ selected.component.repoUrl || '—' }}</span></div>
              <div class="row"><span>默认分支</span><span class="mono">{{ selected.component.defaultBranch || '—' }}</span></div>
              <div class="row"><span>语言</span><span>{{ selected.component.language || '—' }}</span></div>
            </div>
            <div class="toolbar">
              <button class="btn btn-primary btn-sm" @click="goComponent(selected.component!)">进入组件详情 →</button>
            </div>
          </template>
        </template>
        <div v-else class="empty">选择左侧节点查看详情</div>
      </div>
    </div>

    <!-- 创建组织 -->
    <Modal :open="orgDialog" title="创建组织" @close="orgDialog = false">
      <div class="field">
        <label>组织名称 *</label>
        <input v-model="orgForm.name" class="input" placeholder="如：平台工程部" maxlength="128" />
      </div>
      <div class="field">
        <label>标识 slug *</label>
        <input v-model="orgForm.slug" class="input" placeholder="小写字母/数字/连字符，如 platform-eng" maxlength="64" />
      </div>
      <div class="hint">创建组织后会自动生成同名服务树（default）。</div>
      <template #foot>
        <button class="btn btn-pearl" @click="orgDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="orgCreating" @click="createOrg">
          {{ orgCreating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- 添加服务 -->
    <Modal :open="serviceDialog" title="添加服务" @close="serviceDialog = false">
      <div class="field">
        <label>Key *</label>
        <input v-model="serviceForm.key" class="input" placeholder="英文标识，如 user-center" maxlength="64" />
      </div>
      <div class="field">
        <label>名称 *</label>
        <input v-model="serviceForm.name" class="input" placeholder="如：用户中心" maxlength="128" />
      </div>
      <div class="field">
        <label>负责人团队</label>
        <input v-model="serviceForm.ownerTeam" class="input" placeholder="可选" />
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="serviceForm.description" class="input" placeholder="可选" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="serviceDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="serviceCreating" @click="createService">
          {{ serviceCreating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>

    <!-- 添加组件 -->
    <Modal :open="compDialog" title="添加组件" @close="compDialog = false">
      <div class="field">
        <label>Key *</label>
        <input v-model="compForm.key" class="input" placeholder="英文标识，如 user-api" maxlength="64" />
      </div>
      <div class="field">
        <label>名称 *</label>
        <input v-model="compForm.name" class="input" placeholder="如：用户服务 API" maxlength="128" />
      </div>
      <div class="field">
        <label>仓库地址 *</label>
        <input v-model="compForm.repoUrl" class="input" placeholder="https://github.com/org/repo.git" maxlength="512" />
      </div>
      <div class="field">
        <label>默认分支</label>
        <input v-model="compForm.defaultBranch" class="input" placeholder="main" maxlength="128" />
      </div>
      <div class="field">
        <label>语言</label>
        <input v-model="compForm.language" class="input" placeholder="如 go / typescript（可选）" />
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="compForm.description" class="input" placeholder="可选" />
      </div>
      <template #foot>
        <button class="btn btn-pearl" @click="compDialog = false">取消</button>
        <button class="btn btn-primary" :disabled="compCreating" @click="createComponent">
          {{ compCreating ? '创建中…' : '创建' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.md { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; }
.tree-panel { padding: 14px; max-height: calc(100vh - 220px); overflow-y: auto; }
.tree-panel .input { margin-bottom: 10px; }
.tnode {
  padding: 7px 10px; border-radius: 8px; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; gap: 6px;
}
.tnode:hover { background: var(--parchment); }
.tnode.sel { background: var(--action-blue-soft); color: var(--action-blue); font-weight: 600; }
.tnode.l1 { padding-left: 26px; font-size: 13px; }
.tnode.l2 { padding-left: 44px; font-size: 13px; color: var(--sub); }
.caret { font-size: 10px; color: var(--sub); }
.count { margin-left: auto; font-size: 11px; color: var(--sub); }
.detail-panel { min-height: 300px; }
.kv-list { margin-top: 12px; }
.kv-list .row {
  display: flex; justify-content: space-between; gap: 16px;
  padding: 9px 0; border-bottom: 1px solid var(--sub-hairline); font-size: 13px;
}
.kv-list .row span:first-child { color: var(--sub); }
</style>
