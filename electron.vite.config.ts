import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const projectRoot = resolve(__dirname)

const srcAlias = {
  '@main': resolve('src/main'),
  '@preload': resolve('src/preload'),
  '@renderer': resolve('src/renderer/src'),
  '@components': resolve('src/renderer/src/components'),
  '@hooks': resolve('src/renderer/src/hooks'),
  '@lib': resolve('src/renderer/src/lib'),
  '@pages': resolve('src/renderer/src/pages'),
  '@providers': resolve('src/renderer/src/providers'),
  '@resources': resolve('resources')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    resolve: { alias: srcAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: srcAlias }
  },
  renderer: {
    resolve: { alias: srcAlias },
    server: {
      fs: {
        allow: [projectRoot]
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
