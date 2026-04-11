import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCrmWriteDraft,
  classifySlackText,
  synthesizeCrmQueryReply,
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
            type: 'tool_use',
            name: 'plan_crm_query',
            input: {
              intentType: 'QUERY',
              confidence: 0.91,
              summary: 'Anthropic 분류 결과',
              queryCategory: 'GENERAL',
              detailLevel: 'SUMMARY',
              timeframe: 'ALL_TIME',
              focusEntity: 'OPPORTUNITY',
              entityHints: {
                companies: ['미래금융'],
                people: [],
                opportunities: [],
                solutions: [],
              },
            },
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
      tools: [
        expect.objectContaining({
          name: 'plan_crm_query',
          strict: true,
        }),
      ],
      messages: [
        {
          role: 'user',
          content: expect.stringContaining('<message>미래금융 상태 알려줘</message>'),
        },
      ],
    });
    expect(body?.system).toContain('Use the provided strict tool exactly once');
  });

  it('should classify monthly summary questions as QUERY', async () => {
    const result = await classifySlackText('이번달 신규 영업기회 몇 건이야?');

    expect(result.intentType).toBe('QUERY');
    expect(result.queryCategory).toBe('MONTHLY_NEW');
  });

  it('should classify detailed monthly requests with a detailed response plan', async () => {
    const result = await classifySlackText(
      '전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘',
    );

    expect(result.intentType).toBe('QUERY');
    expect(result.queryCategory).toBe('MONTHLY_NEW');
    expect(result.detailLevel).toBe('DETAILED');
  });

  it('should build a safe fallback write draft with at least a note', async () => {
    const draft = await buildCrmWriteDraft(
      '미래금융 고객사 미팅했고 다음주에 Citrix VDI 제안서 보내야 해',
    );

    expect(draft.actions.length).toBeGreaterThan(0);
    expect(draft.actions.some((action) => action.kind === 'note')).toBe(true);
  });

  it('should strip Slack mentions from fallback draft titles and source text', async () => {
    const draft = await buildCrmWriteDraft(
      '<@U0AS65R9QHK> A은행에 Nutanix 전환 기회가 생겼고 담당자는 김민수, 5월 말 POC 예정',
    );

    const noteAction = draft.actions.find((action) => action.kind === 'note');

    expect(draft.sourceText).not.toContain('<@U0AS65R9QHK>');
    expect(noteAction?.data.title).not.toContain('<@U0AS65R9QHK>');
    expect(String(noteAction?.data.title ?? '')).not.toContain('Slack 메모 -');
  });

  it('should synthesize detailed CRM replies via Anthropic structured outputs', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              text: '이번달 신규 영업기회 2건을 상세 정리했습니다.',
              sections: [
                {
                  title: '신규 영업기회 상세',
                  body: '1. A은행 Nutanix 전환 / 담당자 김민수 / 단계 DISCOVERY_POC',
                },
                {
                  title: '의견',
                  body: 'POC 일정과 견적 전환 조건을 먼저 확인하는 것이 좋습니다.',
                },
              ],
            }),
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const reply = await synthesizeCrmQueryReply({
      requestText:
        '전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘',
      classification: {
        intentType: 'QUERY',
        confidence: 0.92,
        summary: '상세 신규 영업기회 조회',
        queryCategory: 'MONTHLY_NEW',
        detailLevel: 'DETAILED',
        timeframe: 'THIS_MONTH',
        focusEntity: 'OPPORTUNITY',
        entityHints: {
          companies: [],
          people: [],
          opportunities: [],
          solutions: [],
        },
      },
      crmContext: {
        monthlyNew: {
          companyCount: 2,
          peopleCount: 3,
          opportunityCount: 2,
          opportunities: [
            {
              name: 'A은행 Nutanix 전환',
              companyName: 'A은행',
              pointOfContactName: '김민수',
              stage: 'DISCOVERY_POC',
            },
          ],
        },
      },
    });

    expect(reply?.text).toContain('상세 정리');
    expect(reply?.blocks).toHaveLength(2);

    const request = fetchMock.mock.calls[0]?.[1];
    const body =
      request && typeof request === 'object' && 'body' in request
        ? JSON.parse(String(request.body))
        : null;

    expect(body?.output_config?.format?.type).toBe('json_schema');
    expect(body?.output_config?.effort).toBe('medium');
  });
});
