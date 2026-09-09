<script setup lang="ts">
// 居中模态框：触发运行、确认删除等小体量交互。
defineProps<{ open: boolean; title: string; width?: number }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <div class="modal" :style="{ width: (width ?? 520) + 'px' }">
        <div class="mh">
          <h3>{{ title }}</h3>
          <span class="closex" @click="emit('close')">×</span>
        </div>
        <div class="mbody"><slot /></div>
        <div v-if="$slots.foot" class="mfoot"><slot name="foot" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; background: rgba(29, 29, 31, 0.32); z-index: 200;
  display: grid; place-items: center;
}
.modal {
  background: #fff; border-radius: var(--radius-card);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
  max-height: 84vh; display: flex; flex-direction: column;
  animation: pop 0.2s ease;
}
@keyframes pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
.mh {
  padding: 16px 22px; border-bottom: 1px solid var(--hairline);
  display: flex; align-items: center; justify-content: space-between;
}
.mh h3 { font-size: 17px; font-weight: 600; }
.mbody { padding: 20px 22px; overflow-y: auto; }
.mfoot {
  padding: 14px 22px; border-top: 1px solid var(--hairline);
  display: flex; gap: 10px; justify-content: flex-end;
}
.closex { cursor: pointer; color: var(--sub); font-size: 22px; line-height: 1; }
.closex:hover { color: var(--ink); }
</style>
