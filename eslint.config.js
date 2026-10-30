import globals from 'globals';
import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

const fastConfig = [
  {
    ignores: ['.audit-tools/**', '.zcode/plans/**', 'dist/**', 'release/**', 'src-tauri/target/**', 'src-tauri/gen/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  { files: ['src/**/*.spec.ts'], rules: { 'vue/one-component-per-file': 'off' } },
  {
    files: ['**/*.vue', '**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      'vue/attributes-order': 'off',
      'vue/html-quotes': 'off',
      'vue/mustache-interpolation-spacing': 'off',
      'vue/no-multi-spaces': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];

export const fullConfig = [
  ...fastConfig,
  {
    files: ['**/*.ts', '**/*.vue', 'scripts/**/*.mjs', 'eslint*.config.js'],
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.json',
          './tsconfig.test.json',
          './tsconfig.node.json',
          './tsconfig.scripts.json',
          './tsconfig.browser-scripts.json',
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: '@types/node', name: 'test' }] },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': ['error', { allowMixedPromiseArrays: true }],
      '@typescript-eslint/return-await': ['error', 'error-handling-correctness-only'],
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
    },
  },
];

export default fastConfig;
