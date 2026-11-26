import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// v2 的架构约束。规则随层出现而增补，宁少勿虚：
// 已生效：ADR-007 —— 业务代码不得直接 new Date()，时间只经 Clock/dayKey。
// 待增补（对应模块建立时再加）：
//   - 存储驱动仅 store/ 可 import（ADR-002）
//   - 生成层不得 import 采集层（分层依赖方向）
//   - 汇总查询不得 SELECT content（ADR-006，靠测试白盒断言）
const noNewDateRule = {
  selector: "NewExpression[callee.name='Date']",
  message: '业务代码不得直接 new Date()，请注入 Clock（ADR-007）',
};

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'docs/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-throw-literal': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/clock.ts'],
    rules: {
      'no-restricted-syntax': ['error', noNewDateRule],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/store/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'better-sqlite3',
              message: 'better-sqlite3 仅允许在 src/store/ 内使用（ADR-002）',
            },
          ],
        },
      ],
    },
  },
);
