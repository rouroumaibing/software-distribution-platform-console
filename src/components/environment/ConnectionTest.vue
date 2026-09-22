<script setup lang="ts">
// §7.12.5 连接测试结果显示：逐项 ✓/✕/跳过 + 明细 + "N/M 通过" 徽章 + 最近测试时间。
import type { TestReport } from '@/api/environment'

defineProps<{ report: TestReport | null; running?: boolean }>()

function rowClass(s: string) {
  return s === 'pass' ? 'pass' : s === 'fail' ? 'fail' : 'skip'
}
</script>

<template>
  <div class="test">
    <div v-if="running" class="loading">正在逐项探测…</div>
    <template v-else-if="report">
      <div class="summary">
        <span class="badge" :class="report.status === 'verified' ? 'b-succ' : report.status === 'failed' ? 'b-warn' : 'b-pend'">
          {{ report.passed }}/{{ report.total }} 项通过
        </span>
        <span class="muted">最近测试：{{ report.testedAt }}</span>
      </div>
      <ul class="items">
        <li v-for="(it, i) in report.items" :key="i" :class="rowClass(it.status)">
          <span class="mark">{{ it.status === 'pass' ? '✓' : it.status === 'fail' ? '✕' : '–' }}</span>
          <span class="name">{{ it.name }}</span>
          <span v-if="it.detail" class="detail">{{ it.detail }}</span>
          <span v-else-if="it.status === 'skip'" class="detail muted">跳过（hub 无出站能力，由执行器实测）</span>
        </li>
      </ul>
      <p v-if="report.status === 'failed'" class="note warn">存在未通过项，保存不受影响，但会挡住发布门禁。</p>
      <p v-else-if="report.status === 'verified'" class="note ok">连接测试全部通过，可发布。</p>
    </template>
    <div v-else class="muted empty">尚未运行连接测试。</div>
  </div>
</template>

<style scoped>
.test { font-size: 13px; }
.summary { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.muted { color: var(--sub); font-size: 12px; }
.items { list-style: none; padding: 0; margin: 0; }
.items li {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border-radius: 8px; margin-bottom: 4px; background: var(--parchment); font-size: 13px;
}
.items li .mark { font-weight: 700; width: 16px; text-align: center; }
.items li.pass .mark { color: var(--succeeded-fg); }
.items li.fail { background: var(--failed-bg); }
.items li.fail .mark { color: var(--failed-fg); }
.items li.skip .mark { color: var(--sub); }
.items li .name { font-weight: 500; }
.items li .detail { margin-left: auto; color: var(--sub); font-size: 12px; }
.items li .detail.muted { font-style: italic; }
.empty { padding: 8px 0; }
.note { margin-top: 10px; font-size: 12px; padding: 8px 12px; border-radius: 8px; }
.note.ok { background: var(--succeeded-bg); color: var(--succeeded-fg); }
.note.warn { background: var(--warning-bg); color: var(--warning-fg); }
</style>
