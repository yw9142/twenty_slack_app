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

import { buildCrmWriteDraft } from 'src/utils/intelligence';

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  fetchWriteCandidateContext.mockClear();
  vi.unstubAllGlobals();
});

describe('schema-guided write draft normalization', () => {
  it('should normalize AI write drafts to supported writable fields only', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.ANTHROPIC_MODEL = 'claude-test-model';

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  summary: 'CRM 반영 초안',
                  confidence: 0.92,
                  sourceText:
                    '오늘 SK하이닉스 데이터플랫폼팀 미팅 완료. 엔드유저는 SK하이닉스이고, 파트너사는 이포즌이다. 이번 기회의 제품은 TIBCO이며, 실시간 데이터 통합 고도화 수요가 확인됐다.',
                  actions: [
                    {
                      kind: 'company',
                      operation: 'create',
                      data: {
                        name: 'SK하이닉스',
                        domainName: 'https://www.skhynix.com',
                        partnerName: '이포즌',
                      },
                    },
                    {
                      kind: 'opportunity',
                      operation: 'create',
                      data: {
                        name: 'SK하이닉스 TIBCO 고도화',
                        companyName: 'SK하이닉스',
                        pointOfContactName: '김민수',
                        stage: 'DISCOVERY_POC',
                        closeDate: '2026-05-31',
                        primaryVendorCompany: 'TIBCO',
                        partnerName: '이포즌',
                      },
                    },
                    {
                      kind: 'note',
                      operation: 'create',
                      data: {
                        title: 'SK하이닉스 TIBCO 미팅 메모',
                        body:
                          '엔드유저는 SK하이닉스, 파트너사는 이포즌, 제품은 TIBCO. 5월 말 PoC 검토.',
                        companyName: 'SK하이닉스',
                        opportunityName: 'SK하이닉스 TIBCO 고도화',
                      },
                    },
                  ],
                  warnings: [],
                  review: {
                    overview: '리뷰',
                    opinion: '의견',
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
                  companies: [],
                  people: [],
                }),
              },
            ],
          }),
        }),
    );

    const draft = await buildCrmWriteDraft(
      '오늘 SK하이닉스 데이터플랫폼팀 미팅 완료. 엔드유저는 SK하이닉스이고, 파트너사는 이포즌이다. 이번 기회의 제품은 TIBCO이며, 실시간 데이터 통합과 운영 모니터링 고도화 수요가 확인됐다. 고객 실무 담당자는 김민수 책임이다.',
    );

    const companyAction = draft.actions.find((action) => action.kind === 'company');
    const opportunityAction = draft.actions.find(
      (action) => action.kind === 'opportunity',
    );
    const noteAction = draft.actions.find((action) => action.kind === 'note');

    expect(companyAction?.data.name).toBe('SK하이닉스');
    expect(companyAction?.data).not.toHaveProperty('partnerName');
    expect(opportunityAction?.data.name).toBe('SK하이닉스 TIBCO 고도화');
    expect(opportunityAction?.data).not.toHaveProperty('primaryVendorCompany');
    expect(opportunityAction?.data).not.toHaveProperty('partnerName');
    expect(String(noteAction?.data.body ?? '')).toContain('이포즌');
    expect(String(noteAction?.data.body ?? '')).toContain('TIBCO');
  });
});
