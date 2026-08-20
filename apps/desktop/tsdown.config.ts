import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/src/main.js', 'lib/types/src/runtime-resolver.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
