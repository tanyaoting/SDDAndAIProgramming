import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../src/clock.js';
import { DEFAULT_TICK_MS, Scheduler, minutesOfTime } from '../../src/publisher/scheduler.js';

function schedulerAt(
  iso: string,
  pushTime: () => string,
  state: { hasPushed: (date: string) => boolean; pushes: string[] },
): Scheduler {
  return new Scheduler({
    clock: new FixedClock(new Date(iso)),
    pushTime,
    hasPushed: state.hasPushed,
    push: (reportDate) => {
      state.pushes.push(reportDate);
      return Promise.resolve();
    },
    logger: (): void => undefined,
  });
}

describe('T-019 调度与补发', () => {
  it('未到推送时间不执行；到点执行（catchUp=false）', async () => {
    const state = { hasPushed: (): boolean => false, pushes: [] as string[] };
    const before = schedulerAt('2026-11-25T17:59:00+08:00', () => '18:00', state);
    expect(await before.tick()).toMatchObject({ pushed: false, reason: 'not-due' });
    expect(state.pushes).toHaveLength(0);

    const onTime = schedulerAt('2026-11-25T18:00:00+08:00', () => '18:00', state);
    expect(await onTime.tick()).toMatchObject({ pushed: true, catchUp: false });
    expect(state.pushes).toEqual(['2026-11-25']);
  });

  it('错过时点后补发，且 5 分钟内触发（CS-08）', async () => {
    expect(DEFAULT_TICK_MS).toBeLessThanOrEqual(5 * 60_000);
    const state = { hasPushed: (): boolean => false, pushes: [] as string[] };
    const scheduler = schedulerAt('2026-11-25T18:03:00+08:00', () => '18:00', state);
    const result = await scheduler.tick();
    expect(result).toMatchObject({ pushed: true, catchUp: true });
    expect(state.pushes).toEqual(['2026-11-25']);
  });

  it('已有成功推送记录时不再补发（push_log 去重）', async () => {
    const state = { hasPushed: (): boolean => true, pushes: [] as string[] };
    const scheduler = schedulerAt('2026-11-25T18:03:00+08:00', () => '18:00', state);
    expect(await scheduler.tick()).toMatchObject({ pushed: false, reason: 'already-pushed' });
    expect(state.pushes).toHaveLength(0);
  });

  it('修改推送时间后下一次 tick 按新时间执行', async () => {
    let pushTime = '18:00';
    const state = { hasPushed: (): boolean => false, pushes: [] as string[] };
    const scheduler = schedulerAt('2026-11-25T16:00:00+08:00', () => pushTime, state);

    expect(await scheduler.tick()).toMatchObject({ pushed: false, reason: 'not-due' });
    pushTime = '15:30';
    expect(await scheduler.tick()).toMatchObject({ pushed: true });
    expect(state.pushes).toEqual(['2026-11-25']);
  });

  it('推送时间解析与跨日边界', () => {
    expect(minutesOfTime('00:00')).toBe(0);
    expect(minutesOfTime('18:30')).toBe(1110);
    expect(() => minutesOfTime('24:00')).toThrow();
  });
});
