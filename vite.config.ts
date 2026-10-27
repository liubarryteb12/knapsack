import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { syncModManifestIndex } from './scripts/lib/mod-index.mjs'

syncModManifestIndex()

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
})
