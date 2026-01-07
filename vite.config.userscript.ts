import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Read package.json for version
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const userscriptHeader = `// ==UserScript==
// @name         AVE Script
// @namespace    https://github.com/xob0t/ave-script
// @version      ${pkg.version}
// @description  Block unwanted sellers and listings on Avito
// @author       xob0t
// @match        *://www.avito.ru/*
// @match        *://m.avito.ru/*
// @icon         https://www.avito.ru/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @homepage     https://github.com/xob0t/ave-script
// @supportURL   https://github.com/xob0t/ave-script/issues
// @downloadURL  https://github.com/xob0t/ave-script/releases/latest/download/ave_script.user.js
// @updateURL    https://github.com/xob0t/ave-script/releases/latest/download/ave_script.user.js
// ==/UserScript==
`;

// Plugin to prepend userscript header
function userscriptHeaderPlugin(): Plugin {
  return {
    name: 'userscript-header',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && chunk.fileName.endsWith('.user.js')) {
          chunk.code = `${userscriptHeader}\n${chunk.code}`;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [userscriptHeaderPlugin()],
  build: {
    lib: {
      entry: resolve(__dirname, 'userscript/main.ts'),
      name: 'AVEScript',
      formats: ['iife'],
      fileName: () => 'ave_script.user.js',
    },
    outDir: '.output/userscript',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // Redirect state and storage imports to userscript versions
      '@/utils/state': resolve(__dirname, 'userscript/state.ts'),
      '@/utils/storage': resolve(__dirname, 'userscript/storage.ts'),
      '../utils/state': resolve(__dirname, 'userscript/state.ts'),
      '../utils/storage': resolve(__dirname, 'userscript/storage.ts'),
      './state': resolve(__dirname, 'userscript/state.ts'),
      './storage': resolve(__dirname, 'userscript/storage.ts'),
    },
  },
});
