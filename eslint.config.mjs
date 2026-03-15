import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- TypeScript strict rules (all error) ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-deprecated': 'error',

      // --- Naming convention ---
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase', 'snake_case'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'property',
          format: null,
        },
        {
          selector: 'enumMember',
          format: ['PascalCase', 'UPPER_CASE'],
        },
      ],

      // --- Complexity ---
      complexity: ['error', { max: 20 }],

      // --- Custom: DB query must have type assertion ---
      'no-restricted-syntax': ['error', {
        selector: 'CallExpression[callee.property.name="all"]:not([parent.type="TSAsExpression"])',
        message: 'db.prepare().all() must have a type assertion: .all() as SomeRow[]',
      }],

      // --- Off ---
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  // --- L1 files: cannot import L2 or L3 (ARCH-02) ---
  {
    files: ['src/village-manager.ts', 'src/constitution-store.ts', 'src/skill-registry.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['./chief-engine', './law-engine', './risk-assessor', './loop-runner', './decision-engine', './llm-advisor', './candidate-filter'],
          message: 'L1 module cannot import L2/L3 modules (ARCH-02)',
        }],
      }],
    },
  },
  // --- L2 files: cannot import L3 (ARCH-02) ---
  {
    files: ['src/chief-engine.ts', 'src/law-engine.ts', 'src/risk-assessor.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['./loop-runner', './decision-engine', './llm-advisor', './candidate-filter'],
          message: 'L2 module cannot import L3 modules (ARCH-02)',
        }],
      }],
    },
  },
  // --- Ignore test files and config files ---
  {
    ignores: [
      '**/*.test.ts',
      'tests/**',
      'dist/**',
      'node_modules/**',
      '*.config.*',
      'vitest.config.*',
    ],
  },
);
