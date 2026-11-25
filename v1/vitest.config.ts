import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 每个测试文件内挂载测试记录钩子，结果写入 tests/logs/
    setupFiles: ['./tests/setup/test-log.ts'],
  },
});
