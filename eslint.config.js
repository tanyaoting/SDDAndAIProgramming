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

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/sdr/**/*.ts'],
    ignores: ['src/sdr/store/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noSqlitePattern] }],
    },
  },
  {
    files: ['src/sdr/generator/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noSqlitePattern, noCollectorsPattern] }],
    },
  },
);
