import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/SefirahFog.tsx',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  minify: true,
  treeshake: false,
  external: ['react'],
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  plugins: [
    {
      name: 'use-client-react',
      renderChunk(code, info) {
        if (!/[/\\]react[/\\]index\.(mjs|cjs)$/.test(info.path)) return;
        const cleaned = code.replace(
          /^((?:['"]use strict['"];?\s*)?)(['"])use client\2;?\s*/,
          '$1'
        );
        return { code: `'use client';${cleaned}` };
      },
    },
  ],
});
