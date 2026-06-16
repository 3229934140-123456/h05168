import { build } from 'esbuild'

async function bundle() {
  try {
    await build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'iife',
      globalName: 'MiniReactive',
      outfile: 'dist/mini-reactive.iife.js',
      sourcemap: true,
      minify: false,
      target: ['es2020'],
    })
    console.log('✓ IIFE bundle created: dist/mini-reactive.iife.js')
  } catch (e) {
    console.error('Build failed:', e)
    process.exit(1)
  }
}

bundle()
