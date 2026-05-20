import { build } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');
const watchConfig = isWatch ? { watch: {} } : {};

try {
  console.log('Building Popup UI...');
  await build({
    build: {
      ...watchConfig,
    },
  });

  console.log('Building Background Script...');
  await build({
    configFile: false,
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background/index.ts'),
        name: 'background',
        formats: ['iife'],
        fileName: () => 'background.js',
      },
      ...watchConfig,
    },
  });

  console.log('Building Content Script...');
  await build({
    configFile: false,
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/content/index.ts'),
        name: 'content',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      ...watchConfig,
    },
  });

  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
