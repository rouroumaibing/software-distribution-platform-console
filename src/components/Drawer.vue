<script setup lang="ts">
// 右侧滑出抽屉：子任务表单、详情编辑等使用。点击遮罩或 × 关闭。
defineProps<{ open: boolean; title: string; width?: number }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')"></div>
    <aside class="drawer" :class="{ open }" :style="{ width: (width ?? 480) + 'px' }">
      <div class="dh">
        <h3>{{ title }}</h3>
        <span class="closex" @click="emit('close')">×</span>
      </div>
      <div class="dbody"><slot /></div>
      <div v-if="$slots.foot" class="dfoot"><slot name="foot" /></div>
    </aside>
  </Teleport>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(29, 29, 31, 0.32); z-index: 200; }
.drawer {
  position: fixed; top: 0; right: 0; height: 100%; background: #fff; z-index: 201;
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.12);
  transform: translateX(100%); transition: transform 0.28s ease;
  display: flex; flex-direction: column;
}
.drawer.open { transform: translateX(0); }
.dh {
  padding: 18px 22px; border-bottom: 1px solid var(--hairline);
  display: flex; align-items: center; justify-content: space-between;
}
.dh h3 { font-size: 17px; font-weight: 600; }
.dbody { padding: 20px 22px; overflow-y: auto; flex: 1; }
.dfoot {
  padding: 14px 22px; border-top: 1px solid var(--hairline);
  display: flex; gap: 10px; justify-content: flex-end;
}
.closex { cursor: pointer; color: var(--sub); font-size: 22px; line-height: 1; }
.closex:hover { color: var(--ink); }
</style>
