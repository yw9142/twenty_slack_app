import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCrmWriteDraft,
  classifySlackText,
} from 'src/utils/intelligence';

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  vi.unstubAllGlobals();
});

describe('intelligence fallbacks', () => {
  it('should call Anthropic Messages API when anthropic config is present', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.ANTHROPIC_MODEL = 'claude-test-model';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              intentType: 'QUERY',
              confidence: 0.91,
              summary: 'Anthropic 분류 결과',
              queryCategory: 'GENERAL',
              entityHints: {
                companies: ['미래금융'],
                people: [],
                opportunities: [],
                solutions: [],
              },
            }),
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await classifySlackText('미래금융 상태 알려줘');

    expect(result.summary).toBe('Anthropic 분류 결과');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json; charset=utf-8',
          'x-api-key': 'test-anthropic-key',
        }),
      }),
    );

    const request = fetchMock.mock.calls[0]?.[1];
    const body =
      request && typeof request === 'object' && 'body' in request
        ? JSON.parse(String(request.body))
        : null;

    expect(body).toMatchObject({
      model: 'claude-test-model',
      messages: [
        {
          role: 'user',
          content: '미래금융 상태 알려줘',
        },
      ],
    });
    expect(body?.system).toContain('You classify Slack messages');
  });

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
