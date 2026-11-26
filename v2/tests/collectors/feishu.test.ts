import { describe, expect, it, vi } from 'vitest';
import { FixedClock, dayWindow } from '../../src/clock.js';
import { ERROR_CODES } from '../../src/errors.js';
import { HttpResponseError, createHttpClient } from '../../src/http.js';
import { collectFeishu } from '../../src/collectors/feishu.js';

describe('collectFeishu', () => {
  const clock = new FixedClock(new Date('2026-11-25T12:00:00+08:00'));
  const { since, until } = dayWindow(clock, '2026-11-25');

  it('completed 状态映射 kind=task_done', async () => {
    const http = createHttpClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            code: 0,
            data: {
              has_more: false,
              items: [
                {
                  id: 'task-1',
                  title: '完成联调',
                  status: 'completed',
                  completed_at: '2026-11-25T04:00:00.000Z',
                },
              ],
            },
          }),
        ),
    });

    const events = await collectFeishu({
      since,
      until,
      token: 'tenant-token',
      clock,
      memberId: 2,
      runId: 'run-feishu',
      http,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'feishu',
      sourceId: 'task-1',
      kind: 'task_done',
      title: '完成联调',
    });
  });

  it('未知状态仍产出 Event', async () => {
    const http = createHttpClient({
      fetchImpl: vi.fn().mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            has_more: false,
            items: [
              {
                id: 'task-2',
                title: '调研竞品',
                status: 'weird',
                updated_at: '2026-11-25T05:00:00.000Z',
              },
            ],
          },
        }),
      ),
    });

    const events = await collectFeishu({
      since,
      until,
      token: 'tenant-token',
      clock,
      memberId: 2,
      runId: 'run-feishu',
      http,
    });

    expect(events[0]?.title).toBe('调研竞品');
    expect(events[0]?.kind).not.toBe('task_done');
  });

  it('授权失败映射 SDR-E201', async () => {
    const http = createHttpClient({
      fetchImpl: vi.fn().mockRejectedValue(new HttpResponseError(401, { code: 99991663 })),
    });

    await expect(
      collectFeishu({
        since,
        until,
        token: 'bad',
        clock,
        memberId: 2,
        runId: 'run-feishu',
        http,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FEISHU_AUTH_FAILED });
  });

  it('字段缺失映射 SDR-E202', async () => {
    const http = createHttpClient({
      fetchImpl: vi.fn().mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: {
            has_more: false,
            items: [{ id: 'x', status: 'done' }],
          },
        }),
      ),
    });

    await expect(
      collectFeishu({
        since,
        until,
        token: 'ok',
        clock,
        memberId: 2,
        runId: 'run-feishu',
        http,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FEISHU_FIELD_MISSING });
  });
});