import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  query,
  synthesizeCrmQueryReply,
  synthesizeCrmQueryReplyWithDiagnostics,
} = vi.hoisted(() => ({
  query: vi.fn(),
  synthesizeCrmQueryReply: vi.fn(),
  synthesizeCrmQueryReplyWithDiagnostics: vi.fn(),
}));

vi.mock('src/utils/core-client', () => ({
  createCoreClient: () => ({
    query,
  }),
}));

vi.mock('src/utils/intelligence', () => ({
  synthesizeCrmQueryReply,
  synthesizeCrmQueryReplyWithDiagnostics,
}));

describe('detailed crm query fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthesizeCrmQueryReply.mockResolvedValue(null);
    synthesizeCrmQueryReplyWithDiagnostics.mockResolvedValue({
      reply: null,
      aiDiagnostics: {
        provider: 'anthropic',
        operation: 'query_synthesis',
        attempted: false,
        succeeded: false,
        model: null,
        status: null,
        reason: 'missing_api_key',
        errorMessage: 'test',
        cache: {
          enabled: true,
          type: 'ephemeral',
          ttl: '5m',
        },
        usage: null,
      },
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('lists opportunities one by one when a detailed monthly query cannot be synthesized', async () => {
    const now = new Date().toISOString();
    const { answerCrmQuery } = await import('src/utils/crm-query');

    query
      .mockResolvedValueOnce({
        companies: {
          edges: [{ node: { id: 'company-1', name: 'A은행', createdAt: now } }],
        },
      })
      .mockResolvedValueOnce({
        people: {
          edges: [
            {
              node: {
                id: 'person-1',
                createdAt: now,
                name: {
                  firstName: '김민수',
                  lastName: '',
                },
                emails: {
                  primaryEmail: 'minsu@abank.co.kr',
                },
                jobTitle: '부장',
                company: {
                  name: 'A은행',
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        opportunities: {
          edges: [
            {
              node: {
                id: 'opp-1',
                name: 'A은행 Nutanix VDI 전환',
                createdAt: now,
                updatedAt: now,
                stage: 'DISCOVERY_POC',
                closeDate: '2026-05-31',
                company: {
                  name: 'A은행',
                },
                pointOfContact: {
                  name: {
                    firstName: '김민수',
                    lastName: '',
                  },
                },
                amount: {
                  amountMicros: 150000000000,
                  currencyCode: 'KRW',
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        noteTargets: {
          edges: [
            {
              node: {
                targetOpportunity: {
                  id: 'opp-1',
                },
                note: {
                  title: 'POC 범위 정리',
                  createdAt: now,
                  bodyV2: {
                    markdown: '5월 말 POC 범위를 정리해달라는 요청을 받음',
                  },
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        taskTargets: {
          edges: [
            {
              node: {
                targetOpportunity: {
                  id: 'opp-1',
                },
                task: {
                  title: '다음주 아키텍처 초안 전달',
                  createdAt: now,
                  dueAt: '2026-04-20',
                  status: 'TODO',
                  bodyV2: {
                    markdown: '고객에게 아키텍처 초안을 전달',
                  },
                },
              },
            },
          ],
        },
      });

    const result = await answerCrmQuery({
      classification: {
        intentType: 'QUERY',
        confidence: 0.92,
        summary: '신규 영업기회 상세 조회',
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
      text: '전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘.',
    });

    const replyText = JSON.stringify(result.reply.blocks ?? []);

    expect(replyText).toContain('A은행 Nutanix VDI 전환');
    expect(replyText).toContain('김민수');
    expect(replyText).toContain('다음주 아키텍처 초안 전달');
    expect(replyText).toContain('신규 영업기회 상세');
  });

  it('falls back to deterministic detail when synthesized output omits opportunity detail', async () => {
    const now = new Date().toISOString();
    synthesizeCrmQueryReply.mockResolvedValueOnce({
      text: '이번달 신규 영업기회 1건입니다.',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*이번달 신규 현황*\n• 회사: *1건*\n• 담당자: *1건*\n• 영업기회: *1건*',
          },
        },
      ],
    });

    const { answerCrmQuery } = await import('src/utils/crm-query');

    query
      .mockResolvedValueOnce({
        companies: {
          edges: [{ node: { id: 'company-1', name: 'A은행', createdAt: now } }],
        },
      })
      .mockResolvedValueOnce({
        people: {
          edges: [
            {
              node: {
                id: 'person-1',
                createdAt: now,
                name: {
                  firstName: '김민수',
                  lastName: '',
                },
                emails: {
                  primaryEmail: 'minsu@abank.co.kr',
                },
                jobTitle: '부장',
                company: {
                  name: 'A은행',
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        opportunities: {
          edges: [
            {
              node: {
                id: 'opp-1',
                name: 'A은행 Nutanix VDI 전환',
                createdAt: now,
                updatedAt: now,
                stage: 'DISCOVERY_POC',
                closeDate: '2026-05-31',
                company: {
                  name: 'A은행',
                },
                pointOfContact: {
                  name: {
                    firstName: '김민수',
                    lastName: '',
                  },
                },
                amount: {
                  amountMicros: 150000000000,
                  currencyCode: 'KRW',
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        noteTargets: {
          edges: [],
        },
      })
      .mockResolvedValueOnce({
        taskTargets: {
          edges: [],
        },
      });

    const result = await answerCrmQuery({
      classification: {
        intentType: 'QUERY',
        confidence: 0.93,
        summary: '신규 영업기회 상세 조회',
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
      text: '전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘.',
    });

    const replyText = JSON.stringify(result.reply.blocks ?? []);

    expect(replyText).toContain('A은행 Nutanix VDI 전환');
    expect(replyText).toContain('신규 영업기회 상세');
  });
});
