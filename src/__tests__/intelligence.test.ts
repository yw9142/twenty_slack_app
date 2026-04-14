import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchWriteCandidateContext } = vi.hoisted(() => ({
  fetchWriteCandidateContext: vi.fn(async () => ({
    companies: [],
    people: [],
    opportunities: [],
  })),
}));

vi.mock('src/utils/crm-write-candidates', () => ({
  fetchWriteCandidateContext,
}));

import {
  buildCrmWriteDraft,
  classifySlackText,
  synthesizeCrmQueryReply,
} from 'src/utils/intelligence';

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  fetchWriteCandidateContext.mockClear();
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
      cache_control: {
        type: 'ephemeral',
        ttl: '5m',
      },
      output_config: {
        effort: 'high',
      },
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
    expect(body?.system).toContain('## Base Instructions');
    expect(body?.system).toContain('## Planning Strategy');
    expect(body?.system).toContain('## Intent Classification Rules');
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

  it('should not infer THIS_MONTH without an explicit monthly timeframe phrase', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

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
              summary: '잘못된 월간 분류',
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
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await classifySlackText(
      '전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘',
    );

    expect(result.timeframe).toBe('ALL_TIME');
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

  it('should extract meaningful company and contact names in fallback drafts', async () => {
    const draft = await buildCrmWriteDraft(
      '오늘 A은행 인프라팀 후속 미팅 완료. 기존에 검토 중이던 Nutanix VDI 전환 건 관련해서 고객 반응이 긍정적이었고, 담당자는 그대로 김민수 부장이다.',
    );

    const companyAction = draft.actions.find((action) => action.kind === 'company');
    const opportunityAction = draft.actions.find(
      (action) => action.kind === 'opportunity',
    );

    expect(companyAction?.data.name).toBe('A은행');
    expect(opportunityAction?.data.companyName).toBe('A은행');
    expect(opportunityAction?.data.pointOfContactName).toBe('김민수');
    expect(String(opportunityAction?.data.name ?? '')).not.toContain('관련해서');
  });

  it('should extract richer meeting facts for crm write drafts', async () => {
    const draft = await buildCrmWriteDraft(
      '오늘 A은행 인프라팀 후속 미팅 완료. 기존에 검토 중이던 Nutanix VDI 전환 건 관련해서 고객 반응이 긍정적이었고, 담당자는 김민수 부장이다. 5월 말 POC 일정으로 내부 검토를 시작하기로 했고 현재 단계는 Discovery/PoC로 보는 게 맞다. 다음주 안에 아키텍처 초안과 예상 비용 범위를 달라고 요청받았다.',
    );

    const personAction = draft.actions.find((action) => action.kind === 'person');
    const opportunityAction = draft.actions.find(
      (action) => action.kind === 'opportunity',
    );
    const taskAction = draft.actions.find((action) => action.kind === 'task');

    expect(personAction?.data.name).toBe('김민수');
    expect(personAction?.data.jobTitle).toBe('부장');
    expect(personAction?.data.companyName).toBe('A은행');
    expect(opportunityAction?.data.stage).toBe('DISCOVERY_POC');
    expect(opportunityAction?.data.closeDate).toBe('2026-05-31');
    expect(taskAction?.data.title).toContain('아키텍처 초안');
    expect(typeof taskAction?.data.dueAt).toBe('string');
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
    expect(body?.cache_control).toMatchObject({
      type: 'ephemeral',
      ttl: '5m',
    });
    expect(body?.output_config?.effort).toBe('high');
    expect(body?.thinking).toMatchObject({
      type: 'adaptive',
      display: 'omitted',
    });
    expect(body?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 2,
        }),
      ]),
    );
    expect(body?.system).toContain('## Base Instructions');
    expect(body?.system).toContain('## Slack Reply Contract');
    expect(body?.system).toContain('## Optional Web Search');
  });

  it('should compact crm context before sending it to Anthropic synthesis', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              text: '정리했습니다.',
              sections: [{ title: '의견', body: '다음 액션을 확인하세요.' }],
            }),
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await synthesizeCrmQueryReply({
      requestText: 'A은행 기회 상세히 알려줘',
      classification: {
        intentType: 'QUERY',
        confidence: 0.8,
        summary: '상세 조회',
        queryCategory: 'OPPORTUNITY_STATUS',
        detailLevel: 'DETAILED',
        timeframe: 'ALL_TIME',
        focusEntity: 'OPPORTUNITY',
        entityHints: {
          companies: ['A은행'],
          people: [],
          opportunities: [],
          solutions: [],
        },
      },
      crmContext: {
        opportunity: {
          name: 'A은행 Nutanix 전환',
          amount: null,
          pointOfContactName: '',
          tags: [],
          nextStep: 'POC 일정 확인',
        },
      },
    });

    const request = fetchMock.mock.calls[0]?.[1];
    const body =
      request && typeof request === 'object' && 'body' in request
        ? JSON.parse(String(request.body))
        : null;
    const userPrompt = body?.messages?.[0]?.content;

    expect(userPrompt).toContain('"nextStep":"POC 일정 확인"');
    expect(userPrompt).not.toContain('"amount":null');
    expect(userPrompt).not.toContain('"pointOfContactName":""');
    expect(userPrompt).not.toContain('"tags":[]');
  });

  it('should use a sectioned write draft system prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    fetchWriteCandidateContext.mockResolvedValue({
      companies: [{ id: 'company-1', name: 'A은행' }],
      people: [{ id: 'person-1', fullName: '김민수', companyName: 'A은행' }],
      opportunities: [{ id: 'opp-1', name: 'A은행 기존 VDI 전환', companyName: 'A은행' }],
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: '초안 요약',
              confidence: 0.8,
              sourceText: 'A은행 Nutanix 전환 기회',
              actions: [],
              warnings: [],
              review: {
                overview: '기존 후보를 검토했습니다.',
                opinion: '기존 기회를 업데이트하는 편이 안전합니다.',
                items: [],
              },
            }),
          },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await buildCrmWriteDraft('A은행에 Nutanix 전환 기회가 생겼다');

    const request = fetchMock.mock.calls[0]?.[1];
    const body =
      request && typeof request === 'object' && 'body' in request
        ? JSON.parse(String(request.body))
        : null;

    expect(body?.system).toContain('## Base Instructions');
    expect(body?.system).toContain('## Drafting Rules');
    expect(body?.system).toContain('## Matching Strategy');
    expect(body?.system).toContain('## Action Construction Rules');
    expect(body?.system).toContain('"blocknote": null');
    expect(body?.output_config?.effort).toBe('high');
    expect(body?.thinking).toMatchObject({
      type: 'adaptive',
      display: 'omitted',
    });
    expect(body?.messages?.[0]?.content).toContain('<candidate_context>');
    expect(body?.messages?.[0]?.content).toContain('A은행 기존 VDI 전환');
  });

  it('should ground sparse ai write drafts with meeting facts and public enrichment', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    fetchWriteCandidateContext.mockResolvedValue({
      companies: [],
      people: [],
      opportunities: [],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary: '초안 요약',
                confidence: 0.8,
                sourceText: 'A은행 Nutanix 전환 기회',
                actions: [
                  {
                    kind: 'company',
                    operation: 'create',
                    data: {
                      name: 'A은행',
                    },
                  },
                  {
                    kind: 'opportunity',
                    operation: 'create',
                    data: {
                      name: '신규 영업기회',
                    },
                  },
                ],
                warnings: [],
                review: {
                  overview: '초안',
                  opinion: '초안',
                  items: [],
                },
              }),
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                companies: [
                  {
                    name: 'A은행',
                    domainName: 'https://www.abank.co.kr',
                    linkedinLink: 'https://www.linkedin.com/company/abank',
                    employees: 1200,
                  },
                ],
                people: [
                  {
                    name: '김민수',
                    companyName: 'A은행',
                    jobTitle: '부장',
                    linkedinLink: 'https://www.linkedin.com/in/minsu-kim',
                    city: 'Seoul',
                  },
                ],
              }),
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const draft = await buildCrmWriteDraft(
      '오늘 A은행 인프라팀 후속 미팅 완료. 기존에 검토 중이던 Nutanix VDI 전환 건 관련해서 고객 반응이 긍정적이었고, 담당자는 김민수 부장이다. 5월 말 POC 일정으로 내부 검토를 시작하기로 했고 현재 단계는 Discovery/PoC로 보는 게 맞다. 다음주 안에 아키텍처 초안과 예상 비용 범위를 달라고 요청받았다.',
    );

    const companyAction = draft.actions.find((action) => action.kind === 'company');
    const personAction = draft.actions.find((action) => action.kind === 'person');
    const opportunityAction = draft.actions.find(
      (action) => action.kind === 'opportunity',
    );
    const taskAction = draft.actions.find((action) => action.kind === 'task');

    expect(companyAction?.data.domainName).toEqual({
      primaryLinkUrl: 'https://www.abank.co.kr',
    });
    expect(companyAction?.data.linkedinLink).toEqual({
      primaryLinkUrl: 'https://www.linkedin.com/company/abank',
    });
    expect(companyAction?.data.employees).toBe(1200);
    expect(personAction?.data.name).toBe('김민수');
    expect(personAction?.data.jobTitle).toBe('부장');
    expect(personAction?.data.linkedinLink).toEqual({
      primaryLinkUrl: 'https://www.linkedin.com/in/minsu-kim',
    });
    expect(opportunityAction?.data.name).toBe('A은행 Nutanix VDI 전환');
    expect(opportunityAction?.data.companyName).toBe('A은행');
    expect(opportunityAction?.data.pointOfContactName).toBe('김민수');
    expect(opportunityAction?.data.stage).toBe('DISCOVERY_POC');
    expect(taskAction?.data.title).toContain('아키텍처 초안');
    expect(draft.review?.items.length).toBeGreaterThan(0);
  });
});
