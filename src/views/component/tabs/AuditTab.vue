<script setup lang="ts">
// 组件审计 Tab（ui-12 5.4 组件级审计下沉，2026-10-11 拍板完整版）：
// 组件管理员（component:manage）查看**本组件**的变更留痕。hub 端把审计行
// 反规范化 component_id，查询被中间件+handler 双保险强制钳到所辖组件。
// 403（非组件管理员）→ 内联锁态，不跳 Forbidden 页（FIVES-STATES 锁图标态：
// 「无权限查看」+ 所需权限标识 component:manage）。
import { onMounted, ref } from 'vue'
import { auditApi, type AuditLog } from '@/api/audit'
import { isAxiosStatus } from '@/api/http'

const props = defineProps<{ componentId: string }>()

const rows = ref<AuditLog[]>([])
const loading = ref(true)
const forbidden = ref(false)
const error = ref('')

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await auditApi.listForComponent(props.componentId)
    forbidden.value = false
  } catch (e) {
    if (isAxiosStatus(e, 403)) {
      forbidden.value = true
    } else {
      error.value = '审计加载失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

function fmtTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div>
    <div class="perm-note">
      这里展示<b>本组件</b>的变更审计（谁在何时对组件 / 流水线 / 运行做了什么）。
      写操作由 hub 审计中间件统一落痕；平台级全量审计在 <b>平台管理 → 审计</b>。
    </div>

    <div class="card flush">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="forbidden" class="empty">
        🔒 无权限查看 —— 组件审计需 <span class="mono">component:manage</span>
        权限，请联系组件管理员
      </div>
      <div v-else-if="error" class="empty">{{ error }} <a @click="load">重试</a></div>
      <div v-else-if="rows.length === 0" class="empty">暂无审计记录</div>
      <table v-else class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>主体</th>
            <th>动作</th>
            <th>资源</th>
            <th>结果</th>
            <th>原因 / 变更单</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="mono">{{ fmtTime(r.timestamp) }}</td>
            <td class="mono" :title="r.subject">{{ r.subject }}</td>
            <td><span class="chip">{{ r.action }}</span></td>
            <td class="mono">
              <template v-if="r.resourceType">{{ r.resourceType }}<template v-if="r.resourceId"> · {{ r.resourceId.slice(0, 8) }}</template></template>
              <template v-else>—</template>
            </td>
            <td><span class="badge">{{ r.result }}</span></td>
            <td>
              <template v-if="r.reason || r.ticket">
                <span v-if="r.reason" :title="r.reason">{{ r.reason }}</span>
                <span v-if="r.ticket" class="mono">（{{ r.ticket }}）</span>
              </template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
