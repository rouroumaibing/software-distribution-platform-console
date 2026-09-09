// 极简全局 toast：任何组件 import 后即可弹出，不需要挂载 UI 库。
import { reactive } from 'vue'

interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error'
}

export const toasts = reactive<ToastItem[]>([])
let seq = 0

function push(text: string, kind: 'info' | 'error') {
  const id = ++seq
  toasts.push({ id, text, kind })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, 2400)
}

export const toast = {
  ok: (text: string) => push(text, 'info'),
  err: (text: string) => push(text, 'error'),
}
