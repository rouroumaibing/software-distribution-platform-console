<script setup lang="ts">
// §7.12 左树：组件 → 分组（可折叠）→ 环境；分组为空时给删除入口，非空不给。
// 未分组的环境聚合到「未分组」桶。每个环境行带状态点（§7.12.6）。
import { computed, ref } from 'vue'
import type { Environment, EnvironmentGroup } from '@/api/environment'
import { ENV_STATUS_META, ENV_ACCESS_LABEL } from '@/api/environment'

const props = defineProps<{
  groups: EnvironmentGroup[]
  envs: Environment[]
  selectedId?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  createEnv: [groupId?: string]
  createGroup: []
  deleteGroup: [id: string]
}>()

// 折叠状态：默认全部展开
const collapsed = ref<Record<string, boolean>>({})

const sortedGroups = computed(() =>
  [...props.groups].sort((a, b) => a.orderIndex - b.orderIndex),
)

function envsOf(groupId?: string) {
  return props.envs.filter((e) => (e.groupId ?? '') === (groupId ?? ''))
}

const grouped = computed(() => sortedGroups.value.map((g) => ({ group: g, items: envsOf(g.id) })))
const ungrouped = computed(() => envsOf(''))

function toggle(groupId: string) {
  collapsed.value[groupId] = !collapsed.value[groupId]
}
</script>

<template>
  <aside class="tree">
    <div class="tree-head">
      <span>环境</span>
      <button class="link-btn" @click="emit('createGroup')">＋ 分组</button>
    </div>

    <div v-for="g in grouped" :key="g.group.id" class="group">
      <div class="group-head">
        <span class="chev" :class="{ open: !collapsed[g.group.id] }" @click="toggle(g.group.id)">▸</span>
        <span class="gname" @click="toggle(g.group.id)">{{ g.group.name }}</span>
        <span class="gcount">{{ g.items.length }}</span>
        <span class="actions">
          <button class="link-btn" title="新建环境到此分组" @click="emit('createEnv', g.group.id)">＋</button>
          <button
            v-if="g.items.length === 0"
            class="link-btn danger"
            title="分组为空，可删除"
            @click="emit('deleteGroup', g.group.id)"
          >🗑</button>
        </span>
      </div>
      <div v-show="!collapsed[g.group.id]" class="group-body">
        <div
          v-for="e in g.items"
          :key="e.id"
          class="env-row"
          :class="{ active: e.id === selectedId }"
          @click="emit('select', e.id)"
        >
          <span class="dot" :style="{ background: ENV_STATUS_META[e.status].dot }"></span>
          <span class="ename">{{ e.name }}</span>
          <span class="etype" :class="e.envType === 'production' ? 'b-fail' : 'b-pend'">{{ e.envType }}</span>
          <span class="eaccess">{{ ENV_ACCESS_LABEL[e.access] }}</span>
        </div>
        <div v-if="g.items.length === 0" class="gempty">空分组</div>
      </div>
    </div>

    <div class="group">
      <div class="group-head">
        <span class="chev open" @click="emit('createEnv')">▸</span>
        <span class="gname" @click="emit('createEnv')">未分组</span>
        <span class="gcount">{{ ungrouped.length }}</span>
        <span class="actions">
          <button class="link-btn" title="新建环境" @click="emit('createEnv')">＋</button>
        </span>
      </div>
      <div class="group-body">
        <div
          v-for="e in ungrouped"
          :key="e.id"
          class="env-row"
          :class="{ active: e.id === selectedId }"
          @click="emit('select', e.id)"
        >
          <span class="dot" :style="{ background: ENV_STATUS_META[e.status].dot }"></span>
          <span class="ename">{{ e.name }}</span>
          <span class="etype" :class="e.envType === 'production' ? 'b-fail' : 'b-pend'">{{ e.envType }}</span>
          <span class="eaccess">{{ ENV_ACCESS_LABEL[e.access] }}</span>
        </div>
        <div v-if="ungrouped.length === 0" class="gempty">暂无环境</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.tree {
  width: 286px; flex: 0 0 286px; border-right: 1px solid var(--hairline);
  background: var(--surface); border-radius: var(--radius-card) 0 0 var(--radius-card);
  padding: 12px 0; max-height: 72vh; overflow-y: auto;
}
.tree-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 16px 10px; font-size: 13px; font-weight: 600; color: var(--sub);
}
.group { padding: 2px 0; }
.group-head {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 13px;
}
.chev { cursor: pointer; color: var(--sub); transition: transform 0.15s; display: inline-block; }
.chev.open { transform: rotate(90deg); }
.gname { font-weight: 600; cursor: pointer; flex: 1; }
.gcount {
  background: var(--parchment); color: var(--sub); border-radius: 9999px;
  font-size: 11px; padding: 1px 7px;
}
.actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.group-head:hover .actions { opacity: 1; }
.group-body { padding: 0 4px 4px; }
.env-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; margin: 1px 0;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.env-row:hover { background: var(--parchment); }
.env-row.active { background: var(--action-blue-soft); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; }
.ename { font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.etype {
  font-size: 10px; padding: 1px 6px; border-radius: 9999px; font-weight: 600;
}
.eaccess { font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70px; }
.gempty { font-size: 12px; color: var(--sub); padding: 4px 14px 8px; }
.link-btn.danger { color: var(--failed-fg); }
</style>
