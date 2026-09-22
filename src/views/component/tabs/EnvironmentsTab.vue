<script setup lang="ts">
// 环境 Tab（§7.12）：左树（分组 + 环境 + 状态点）+ 右对接配置面板 + 两步新建向导。
// 数据：环境列表 / 分组 / 目标 / 凭据库。后端端点对齐 hub 的 /environments、
// /environment-groups、/credentials、/environments/:id/test（均已实现）。
import { onMounted, ref, computed } from 'vue'
import { toast } from '@/utils/toast'
import {
  environmentApi,
  environmentGroupApi,
  credentialApi,
  type Environment,
  type EnvironmentGroup,
  type Credential,
} from '@/api/environment'
import type { Target } from '@/api/target'
import EnvTree from '@/components/environment/EnvTree.vue'
import EnvAccessPanel from '@/components/environment/EnvAccessPanel.vue'
import EnvCreateWizard from '@/components/environment/EnvCreateWizard.vue'

const props = defineProps<{ componentId: string }>()

const envs = ref<Environment[]>([])
const groups = ref<EnvironmentGroup[]>([])
const targets = ref<Target[]>([])
const credentials = ref<Credential[]>([])

const loading = ref(true)
const error = ref('')
const selectedId = ref<string | undefined>(undefined)
const wizardOpen = ref(false)
const wizardGroupId = ref<string | undefined>(undefined)

const selectedEnv = computed(() => envs.value.find((e) => e.id === selectedId.value))

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [e, g, c] = await Promise.all([
      environmentApi.listByComponent(props.componentId, { page: 1, pageSize: 200 }),
      environmentGroupApi.listByComponent(props.componentId, { page: 1, pageSize: 200 }),
      credentialApi.list(undefined, undefined, { page: 1, pageSize: 200 }).catch(() => ({ items: [] as Credential[] })),
    ])
    envs.value = e.items
    groups.value = g.items
    credentials.value = c.items
    await loadTargets()
  } catch (err: any) {
    error.value = '加载环境数据失败：' + (err?.response?.data?.error ?? err?.message ?? '未知错误')
  } finally {
    loading.value = false
  }
}

async function loadTargets() {
  try {
    const r = await (
      await import('@/api/target')
    ).targetApi.list({ page: 1, pageSize: 200 })
    targets.value = r.items
  } catch {
    targets.value = []
  }
}

onMounted(loadAll)

function onSelect(id: string) {
  selectedId.value = id
}

function onCreateEnv(groupId?: string) {
  wizardGroupId.value = groupId
  wizardOpen.value = true
}

async function onCreated(env: Environment) {
  await loadAll()
  selectedId.value = env.id
  toast.ok('已选中新环境，可在右侧继续完善对接配置')
}

function onSaved(env: Environment) {
  const i = envs.value.findIndex((e) => e.id === env.id)
  if (i >= 0) envs.value[i] = env
  else envs.value.push(env)
}

function onDeleted(id: string) {
  envs.value = envs.value.filter((e) => e.id !== id)
  if (selectedId.value === id) selectedId.value = undefined
}

async function onCreateGroup() {
  const name = prompt('分组名称')
  if (!name?.trim()) return
  try {
    const g = await environmentGroupApi.create({ componentId: props.componentId, name: name.trim() })
    groups.value.push(g)
    toast.ok('分组已创建')
  } catch (e: any) {
    toast.err('创建分组失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  }
}

async function onDeleteGroup(id: string) {
  const g = groups.value.find((x) => x.id === id)
  if (!g) return
  const hasEnv = envs.value.some((e) => e.groupId === id)
  if (hasEnv) {
    toast.err('分组非空，无法删除（请先移出或删除组内环境）')
    return
  }
  if (!confirm(`确认删除分组「${g.name}」？`)) return
  try {
    await environmentGroupApi.remove(id)
    groups.value = groups.value.filter((x) => x.id !== id)
    toast.ok('分组已删除')
  } catch (e: any) {
    toast.err('删除分组失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  }
}
</script>

<template>
  <div class="env">
    <div class="toolbar">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" @click="onCreateEnv()">＋ 新建环境</button>
    </div>

    <div v-if="loading" class="loading">加载中…</div>
    <div v-else-if="error" class="err-box">{{ error }} <button class="link-btn" @click="loadAll">重试</button></div>

    <div v-else class="env-layout">
      <EnvTree
        :groups="groups"
        :envs="envs"
        :selected-id="selectedId"
        @select="onSelect"
        @create-env="onCreateEnv"
        @create-group="onCreateGroup"
        @delete-group="onDeleteGroup"
      />

      <div class="env-main">
        <EnvAccessPanel
          v-if="selectedEnv"
          :key="selectedEnv.id"
          :env="selectedEnv"
          :targets="targets"
          :groups="groups"
          :credentials="credentials"
          @saved="onSaved"
          @deleted="onDeleted"
          @close="selectedId = undefined"
        />
        <div v-else class="empty main">
          <p>从左侧选择环境查看对接配置，或新建第一个环境。</p>
          <button class="btn btn-primary btn-sm" @click="onCreateEnv()">＋ 新建环境</button>
        </div>
      </div>
    </div>

    <EnvCreateWizard
      :open="wizardOpen"
      :component-id="componentId"
      :groups="groups"
      :targets="targets"
      :default-group-id="wizardGroupId"
      @close="wizardOpen = false"
      @created="onCreated"
    />
  </div>
</template>

<style scoped>
.env-layout { display: flex; gap: 0; border: 1px solid var(--hairline); border-radius: var(--radius-card); overflow: hidden; min-height: 420px; }
.env-main { flex: 1; display: flex; }
.env-main > :deep(.panel),
.env-main > .empty.main { flex: 1; }
.empty.main { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 48px; }
</style>
