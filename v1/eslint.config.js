import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// 架构约束机器化（design.md §1.2 / ADR-002）：
// 1. 生成层不得 import 采集层；
// 2. 数据库驱动仅限 store/ 模块使用。
const noSqlitePattern = {
  group: ['better-sqlite3', 'better-sqlite3/*'],
  message: '数据库驱动仅限 store/ 模块使用（ADR-002）',
};
const noCollectorsPattern = {
  group: ['**/collectors', '**/collectors/**'],
  message: '生成层不得 import 采集层（design.md §1.2）',
};
// 时钟统一注入（design.md ADR-007 / R-10）：业务代码不得直接 new Date()。
const noNewDateRule = {
  selector: "NewExpression[callee.name='Date']",
  message: '业务代码不得直接 new Date()，请注入 Clock（design.md ADR-007）',
};

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 允许解构剔除场景：const { A, ...rest } = obj（A 并非未使用）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/store/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noSqlitePattern] }],
    },
  },
  {
    // clock.ts 是唯一允许构造 Date 的业务模块；测试不在此 files 范围内。
    files: ['src/**/*.ts'],
    ignores: ['src/clock.ts'],
    rules: {
      'no-restricted-syntax': ['error', noNewDateRule],
    },
  },
  {
    // 唯一的外部请求出口不得依赖任何业务模块（design.md §2）。
    files: ['src/http.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noSqlitePattern,
            { group: ['./*', '../*'], message: 'http.ts 不得 import 任何业务模块（design.md §2）' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/generator/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noSqlitePattern, noCollectorsPattern] }],
    },
  },
);
