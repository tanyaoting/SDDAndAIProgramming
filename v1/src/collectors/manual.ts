import { createHash } from 'node:crypto';
import type { Clock, Event } from '../types.js';
import { makeDedupeKey } from './normalize.js';

/**
 * 手工补充入口（FR-04）。
 * `--manual` 与 `--ref` 必须成对；空串与纯空白拒绝（T-009）。
 */
export class ManualInputError extends Error {
  readonly reason: 'pair' | 'empty';

  constructor(reason: 'pair' | 'empty', message: string) {
    super(message);
    this.name = 'ManualInputError';
    this.reason = reason;
  }
}

export interface ManualNoteLink {
  readonly linkType: 'note';
  readonly target: string;
}

export interface ManualCollected {
  readonly event: Event;
  readonly link: ManualNoteLink;
}

export interface ManualCollectOptions {
  readonly texts: readonly string[];
  readonly ref: string;
  readonly memberId: number;
  readonly runId: string;
  readonly clock: Clock;
}

/** 校验 `--manual` 与 `--ref` 成对出现且非空；不通过抛 ManualInputError（CLI 映射退出码 2）。 */
export function assertManualPair(manual: string | undefined, ref: string | undefined): void {
  if ((manual === undefined) !== (ref === undefined)) {
    throw new ManualInputError('pair', '--manual 与 --ref 必须成对出现');
  }
  if (manual !== undefined && manual.trim() === '') {
    throw new ManualInputError('empty', '--manual 内容不能为空');
  }
  if (ref !== undefined && ref.trim() === '') {
    throw new ManualInputError('empty', '--ref 来源说明不能为空');
  }
}

export function collectManual(options: ManualCollectOptions): ManualCollected[] {
  const ref = options.ref.trim();
  if (ref === '') {
    throw new ManualInputError('empty', '--ref 来源说明不能为空');
  }
  if (options.texts.length === 0) {
    throw new ManualInputError('empty', '至少需要一条手工补充内容');
  }

  const occurredAt = options.clock.now();
  return options.texts.map((raw) => {
    const text = raw.trim();
    if (text === '') {
      throw new ManualInputError('empty', '--manual 内容不能为空');
    }
    const sourceId = createHash('sha1')
      .update(`${options.memberId}:${ref}:${text}`)
      .digest('hex');
    const [firstLine = '', ...rest] = text.split('\n');
    const detail = rest.join('\n').trim();

    const event: Event = {
      memberId: options.memberId,
      source: 'manual',
      sourceId,
      kind: 'note',
      occurredAt,
      title: firstLine.trim(),
      ...(detail.length > 0 ? { detail } : {}),
      dedupeKey: makeDedupeKey({ sourceId, memberId: options.memberId, occurredAt, clock: options.clock }),
      isPrimary: true,
      runId: options.runId,
      payload: { ref },
    };

    return { event, link: { linkType: 'note', target: ref } };
  });
}
