<script setup lang="ts">
// 配置版本历史抽屉（ui-12 §4.1/§4.2）：版本列表 → 详情 / 两版 diff → 高危
// 回滚（必填原因，hub 生成新版本、历史只追加）。scope = 全局或单个环境。
import { computed, ref, watch } from 'vue'
import Drawer from '@/components/Drawer.vue'
import HighRiskConfirm from '@/components/HighRiskConfirm.vue'
import {
  configVersionApi,
  type ConfigSnapshot,
  type ConfigSnapshotDetail,
  type ConfigSnapshotDiff,
} from '@/api/configversion'
import { toast } from '@/utils/toast'

const props = defineProps<{ open: boolean; componentId: string; environments: Array<{ id: string; name: string }> }>()
const emit = defineEmits<{ close: []; rolledback: [] }>()

const scopeEnv = ref('')
const versions = ref<ConfigSnapshot[]>([])
const loading = ref(false)
const view = ref<'list' | 'detail' | 'diff'>('list')
const detail = ref<ConfigSnapshotDetail | null>(null)
const diffA = ref(0)
const diffB = ref(0)
const diff = ref<ConfigSnapshotDiff | null>(null)
const rollbackTarget = ref(0)

const scopeLabel = computed(
  () => props.environments.find((e) => e.id === scopeEnv.value)?.name ?? '全局默认',
)

watch(
  () => props.open,
  (v) => {
    if (v) {
      scopeEnv.value = ''
      view.value = 'list'
      detail.value = null
      diff.value = null
      void load()
    }
  },
)

async function load() {
  loading.value = true
  try {
    versions.value = await configVersionApi.list(props.componentId, scopeEnv.value || undefined)
  } catch (e: any) {
    toast.err('版本列表加载失败：' + (e?.response?.data?.error ?? e?.message ?? '未知错误'))
  } finally {
    loading.value = false
  }
}

async function switchScope() {
  view.value = 'list'
  detail.value = null
  diff.value = null
  await load()
}

async function openDetail(v: ConfigSnapshot) {
  loading.value = true
  try {
    detail.value = (await configVersionApi.get(props.componentId, v.version, scopeEnv.value || undefined)) ?? null
    view.value = 'detail'
  } catch (e: any) {
    toast.err('版本详情加载失败：' + (e?.response?.data?.error ?? e?.message ?? ''))
  } finally {
    loading.value = false
  }
}

function openDiff() {
  if (!diffA.value || !diffB.value || diffA.value === diffB.value) {
    toast.err('请选择两个不同版本')
    return
  }
  void runDiff()
}

async function runDiff() {
  loading.value = true
  try {
    diff.value = (await configVersionApi.diff(props.componentId, diffA.value, diffB.value, scopeEnv.value || undefined)) ?? null
    view.value = 'diff'
  } catch (e: any) {
    toast.err('diff 加载失败：' + (e?.response?.data?.error ?? e?.message ?? ''))
  } finally {
    loading.value = false
  }
}

function askRollback(v: number) {
  rollbackTarget.value = v
}

async function doRollback(a: { reason: string; ticket: string }) {
  try {
    const created = await configVersionApi.rollback(
      props.componentId,
      rollbackTarget.value,
      a.reason,
      a.ticket,
      scopeEnv.value || undefined,
    )
    toast.ok(`已回滚到 v${rollbackTarget.value}，生成新版本 v${created?.version ?? '?'}`)
    view.value = 'list'
    detail.value = null
    await load()
    emit('rolledback')
  } catch (e: any) {
    toast.err('回滚失败：' + (e?.response?.data?.error ?? e?.message ?? ''))
  }
}

const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString() : '—')
</script>

<template>
  <Drawer :open="open" :title="`配置版本历史 · ${scopeLabel}`" :width="640" @close="emit('close')">
    <div class="cv-toolbar">
      <select v-model="scopeEnv" class="select" style="width: auto" @change="switchScope">
        <option value="">全局默认</option>
        <option v-for="e in environments" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
      <template v-if="view === 'list'">
        <select v-model="diffA" class="select" style="width: auto">
          <option :value="0" disabled>对比 A</option>
          <option v-for="v in versions" :key="v.id" :value="v.version">v{{ v.version }}</option>
        </select>
        <span class="sub">→</span>
        <select v-model="diffB" class="select" style="width: auto">
          <option :value="0" disabled>对比 B</option>
          <option v-for="v in versions" :key="v.id" :value="v.version">v{{ v.version }}</option>
        </select>
        <button class="btn btn-pearl" @click="openDiff">diff</button>
      </template>
      <button v-else class="btn btn-pearl" @click="view = 'list'">← 返回列表</button>
    </div>

    <div v-if="loading" class="loading">加载中…</div>

    <!-- 版本列表 -->
    <template v-else-if="view === 'list'">
      <div v-if="versions.length === 0" class="empty">
        该 scope 尚无版本。配置每次保存 / 删除都会自动生成一个整环境快照版本。
      </div>
      <table v-else class="table">
        <thead>
          <tr><th>版本</th><th>说明</th><th>操作人</th><th>时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td class="mono"><b>v{{ v.version }}</b></td>
            <td>{{ v.comment || '—' }}</td>
            <td class="mono sub">{{ v.createdBy?.slice(0, 12) ?? '—' }}</td>
            <td class="sub">{{ fmtTime(v.createdAt) }}</td>
            <td style="white-space: nowrap">
              <a @click="openDetail(v)">详情</a> ·
              <a style="color: var(--failed-fg)" @click="askRollback(v.version)">回滚到此版</a>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 版本详情（密钥恒掩码） -->
    <template v-else-if="view === 'detail' && detail">
      <div class="sub" style="margin-bottom: 10px">
        v{{ detail.version.version }} · {{ detail.version.comment || '（无说明）' }}
      </div>
      <table class="table">
        <thead>
          <tr><th>Key</th><th>值</th><th>类型</th><th>Secret 引用</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in detail.entries" :key="e.key">
            <td class="mono"><b>{{ e.key }}</b></td>
            <td class="mono">{{ e.isSecret ? '••••••' : (e.value ?? '—') }}</td>
            <td>{{ e.isSecret ? 'secret' : 'string' }}</td>
            <td class="mono">{{ e.secretRef || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 两版 diff -->
    <template v-else-if="view === 'diff' && diff">
      <div class="sub" style="margin-bottom: 10px">
        v{{ diff.fromVersion }} → v{{ diff.toVersion }}
        <span v-if="diff.identical"> · 两版完全一致</span>
        <span v-else>
          · 新增 <b>{{ diff.summary.added }}</b> / 删除 <b>{{ diff.summary.removed }}</b> / 修改
          <b>{{ diff.summary.modified }}</b>
        </span>
      </div>
      <table class="table">
        <thead>
          <tr><th>Key</th><th>变更</th><th>v{{ diff.fromVersion }}</th><th>v{{ diff.toVersion }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="k in diff.keys" :key="k.key">
            <td class="mono"><b>{{ k.key }}</b></td>
            <td>
              <span :class="'diff-' + k.change">{{
                k.change === 'added' ? '新增' : k.change === 'removed' ? '删除' : '修改'
              }}</span>
            </td>
            <td class="mono">{{ k.from ?? '—' }}</td>
            <td class="mono">{{ k.to ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <HighRiskConfirm
      :open="rollbackTarget > 0"
      :title="`回滚配置到 v${rollbackTarget} · ${scopeLabel}`"
      :description="`回滚会把「${scopeLabel}」的整份配置恢复为 v${rollbackTarget} 的快照内容（快照中已删除的 key 会被重新创建）。回滚生成新版本，历史不改写。此操作写入审计。`"
      confirm-label="确认回滚"
      @close="rollbackTarget = 0"
      @confirm="doRollback"
    />
  </Drawer>
</template>

<style scoped>
.cv-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.diff-added {
  color: var(--succeeded-fg, #2f9e44);
  font-weight: 600;
}
.diff-removed {
  color: var(--failed-fg, #c0392b);
  font-weight: 600;
}
.diff-modified {
  color: var(--warning-fg, #b7791f);
  font-weight: 600;
}
</style>
