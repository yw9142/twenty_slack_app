import { describe, expect, it } from 'vitest';

import {
  buildCrmWriteDraft,
  classifySlackText,
} from 'src/utils/intelligence';

describe('intelligence fallbacks', () => {
  it('should classify monthly summary questions as QUERY', async () => {
    const result = await classifySlackText('이번달 신규 영업기회 몇 건이야?');

    expect(result.intentType).toBe('QUERY');
    expect(result.queryCategory).toBe('MONTHLY_NEW');
  });

  it('should build a safe fallback write draft with at least a note', async () => {
    const draft = await buildCrmWriteDraft(
      '미래금융 고객사 미팅했고 다음주에 Citrix VDI 제안서 보내야 해',
    );

    expect(draft.actions.length).toBeGreaterThan(0);
    expect(draft.actions.some((action) => action.kind === 'note')).toBe(true);
  });
});
