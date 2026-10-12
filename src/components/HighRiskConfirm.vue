<script setup lang="ts">
// 高危操作统一确认（ui-12 §4.4 / N-22）：展示影响 + 必填原因 + 可选工单号。
// 结构化 reason/ticket 由 hub 审计中间件落 audit_log（middleware.SetAuditReason）。
// 供晋级/回滚、配置回滚、凭据轮转等高危动作复用；审批沿用自身带意见的弹窗。
import { ref, watch } from 'vue'
import Modal from './Modal.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    confirmLabel?: string
    danger?: boolean
    /** 工单号是否展示为可选输入；默认展示（高危动作都该能挂变更单）。 */
    withTicket?: boolean
  }>(),
  { confirmLabel: '确认执行', danger: true, withTicket: true },
)

const emit = defineEmits<{ close: []; confirm: [{ reason: string; ticket: string }] }>()

const reason = ref('')
const ticket = ref('')
const reasonError = ref('')

watch(
  () => props.open,
  (v) => {
    if (v) {
      reason.value = ''
      ticket.value = ''
      reasonError.value = ''
    }
  },
)

function submit() {
  if (!reason.value.trim()) {
    reasonError.value = '高危操作必须填写原因（写入审计）'
    return
  }
  reasonError.value = ''
  emit('confirm', { reason: reason.value.trim(), ticket: ticket.value.trim() })
}
</script>

<template>
  <Modal :open="open" :title="title" @close="emit('close')">
    <div class="hr-desc" :class="{ danger }">{{ description }}</div>
    <div class="hr-field">
      <label>操作原因（必填 · 写入审计）</label>
      <textarea
        v-model="reason"
        rows="3"
        placeholder="例如：发布单 #1287，已通过变更评审"
        @input="reasonError = ''"
      ></textarea>
      <div v-if="reasonError" class="hr-error">{{ reasonError }}</div>
    </div>
    <div v-if="withTicket" class="hr-field">
      <label>工单号（可选，写入审计）</label>
      <input v-model="ticket" placeholder="例如 CHG-1287" />
    </div>
    <template #foot>
      <button class="btn btn-pearl" @click="emit('close')">取消</button>
      <button class="btn" :class="danger ? 'btn-danger' : 'btn-primary'" @click="submit">
        {{ confirmLabel }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.hr-desc {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--sub);
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-2, rgba(127, 127, 127, 0.08));
  margin-bottom: 14px;
}
.hr-desc.danger {
  color: var(--failed-fg, #c0392b);
  background: rgba(192, 57, 43, 0.08);
}
.hr-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 12px;
}
.hr-field label {
  font-size: 12.5px;
  color: var(--sub);
}
.hr-field textarea,
.hr-field input {
  font: inherit;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--hairline);
  background: var(--surface);
  color: var(--ink);
  resize: vertical;
}
.hr-error {
  font-size: 12.5px;
  color: var(--failed-fg, #c0392b);
}
</style>
