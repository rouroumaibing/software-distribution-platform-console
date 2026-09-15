import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 构建产物与构建缓存统一落在 output/ 下（与 `pnpm image` 的交付产物同根），
  // 使「全部生成物」收敛到一个目录：`pnpm clean` 一条 rm -rf output 即清空。
  // 对齐参考工程 old/go-devops/console/vite.config.ts 的 `outDir: './output/dist'`。
  cacheDir: 'output/.vite',
  build: {
    outDir: 'output/dist',
  },
  server: {
    port: 5173,
    proxy: {
      // 开发环境直接代理到本地跑起来的 hub,避免手动处理 CORS。
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
