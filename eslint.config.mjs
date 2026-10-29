import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', 'dist/**', '.tmp/**', 'analyses/**', 'reports/**', 'graphe/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,cjs,mjs,ts}'], languageOptions: { globals: globals.node } },
  {
    files: ['**/*.cjs', 'src/analyse-component-versions.js', 'src/extract-version-test.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
