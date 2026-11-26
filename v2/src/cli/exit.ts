export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  PARTIAL: 3,
  ALL_FAILED: 4,
  ENTRY_NOT_FOUND: 6,
  PUSH_FAILED: 7,
  ACCESS_DENIED: 8,
  CONFIG: 9,
  GENERATE: 10,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];