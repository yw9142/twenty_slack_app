import { describe, expect, it, vi } from 'vitest';

import { processSlackRequestWithCodex } from '../../slack-proxy/runner.mjs';

const toolCatalogResponse = {
  ok: true,
  toolCatalog: {
    modelVisibleTools: [
      {
        name: 'search-opportunities',
        description: 'Search opportunities by query text.',
        policy: 'Use for read-only opportunity lookups.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'create-record',
        description: 'Create a CRM record.',
        policy: 'Use for immediate create mutations.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
            },
            data: {
              type: 'object',
            },
          },
          required: ['kind', 'data'],
        },
      },
      {
        name: 'create-lead-package',
        description: 'Build an approval-first lead registration package.',
        policy: 'Use for 신규 리드 등록 requests and finish with write_draft.',
        inputSchema: {
          type: 'object',
          properties: {
            companyName: {
              type: 'string',
            },
            contactName: {
              type: 'string',
            },
            primaryEmail: {
              type: 'string',
            },
            solutionName: {
              type: 'string',
            },
            sourceText: {
              type: 'string',
            },
          },
          required: ['companyName', 'sourceText'],
        },
      },
      {
        name: 'update-record',
        description: 'Update a CRM record.',
        policy: 'Use for approval-gated update flows.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
            },
            lookup: {
              type: 'object',
            },
            data: {
              type: 'object',
            },
          },
          required: ['kind', 'lookup', 'data'],
        },
      },
      {
        name: 'delete-record',
        description: 'Delete a CRM record.',
        policy: 'Use for approval-gated delete flows.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
            },
            lookup: {
              type: 'object',
            },
          },
          required: ['kind', 'lookup'],
        },
      },
    ],
    internalTools: [
      {
        name: 'load-slack-request',
        description: 'Load the Slack request payload.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {
            slackRequestId: {
              type: 'string',
            },
          },
          required: ['slackRequestId'],
        },
      },
      {
        name: 'get-tool-catalog',
        description: 'Load the tool catalog.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'load-thread-context',
        description: 'Load the Slack thread context.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {
            slackRequestId: {
              type: 'string',
            },
          },
          required: ['slackRequestId'],
        },
      },
      {
        name: 'save-query-answer',
        description: 'Persist a query answer.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'save-write-draft',
        description: 'Persist a write draft.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'save-applied-result',
        description: 'Persist an applied result.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mark-runner-error',
        description: 'Persist runner errors.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'post-slack-reply',
        description: 'Post a Slack reply.',
        policy: 'Runner-only.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  },
};

const buildToolClient = (
  handlers: Array<[string, Record<string, unknown>]>,
) => ({
  callTool: async (
    endpoint: string,
    payload: Record<string, unknown> = {},
  ) => {
    handlers.push([endpoint, payload]);

    if (endpoint === 'load-slack-request') {
      return {
        ok: true,
        slackRequest: {
          id: 'request-1',
          normalizedText: '미래금융 영업기회 보여줘',
          rawText: '@Daou-CRM-slack 미래금융 영업기회 보여줘',
        },
      };
    }

    if (endpoint === 'get-tool-catalog') {
      return toolCatalogResponse;
    }

    if (endpoint === 'load-thread-context') {
      return {
        ok: true,
        threadContext: {
          threadKey: 'T1:C1:thread-1',
          summaryJson: {
            text: '이전 조회가 있었다.',
          },
          recentTurnsJson: [],
          contextJson: {
            selectedCompanyIds: [],
            selectedPersonIds: [],
            selectedOpportunityIds: [],
            selectedLicenseIds: [],
            lastQuerySnapshot: null,
          },
          pendingApprovalJson: null,
          lastSlackRequestId: null,
          lastRepliedAt: null,
        },
      };
    }

    if (endpoint === 'search-opportunities') {
      return {
        ok: true,
        results: [
          {
            id: 'opportunity-1',
            name: '미래금융 VDI',
            stage: 'NEGOTIATION',
            companyName: '미래금융',
          },
        ],
      };
    }

    if (endpoint === 'create-record') {
      return {
        ok: true,
        actionResult: {
          kind: 'company',
          operation: 'create',
          id: 'company-1',
        },
      };
    }

    if (endpoint === 'update-record') {
      return {
        ok: true,
        actionResult: {
          kind: 'opportunity',
          operation: 'update',
          id: 'opportunity-1',
        },
      };
    }

    if (endpoint === 'delete-record') {
      return {
        ok: true,
        actionResult: {
          kind: 'opportunity',
          operation: 'delete',
          id: 'opportunity-1',
        },
      };
    }

    if (endpoint === 'save-query-answer') {
      return {
        id: 'request-1',
        processingStatus: 'ANSWERED',
      };
    }

    if (endpoint === 'save-write-draft') {
      return {
        id: 'request-1',
        processingStatus: 'AWAITING_CONFIRMATION',
      };
    }

    if (endpoint === 'save-applied-result') {
      return {
        id: 'request-1',
        processingStatus: 'APPLIED',
      };
    }

    if (endpoint === 'post-slack-reply') {
      return { ok: true };
    }

    throw new Error(`Unexpected tool call: ${endpoint}`);
  },
});

describe('slack proxy runner', () => {
  it('loads thread context before accepting a query final and requires threadContextPatch', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'query',
        message: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
      })
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'search-opportunities',
        payload: {
          query: '미래금융',
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'query',
        message: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
        threadContextPatch: {
          assistantTurn: {
            text: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
            outcome: 'query',
          },
          summary: '미래금융 영업기회 조회를 마쳤다.',
          selectedEntities: {
            opportunityIds: ['opportunity-1'],
          },
          lastQuerySnapshot: {
            requestId: 'request-1',
            items: [
              {
                id: 'opportunity-1',
                kind: 'opportunity',
                label: '미래금융 VDI',
                order: 0,
                summary: 'NEGOTIATION',
              },
            ],
          },
          pendingApproval: null,
        },
      });

    await processSlackRequestWithCodex({
      slackRequestId: 'request-1',
      toolClient: buildToolClient(toolCalls),
      runCodexDecision,
    });

    expect(runCodexDecision).toHaveBeenCalledTimes(3);
    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-1' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-1' }],
      ['search-opportunities', { query: '미래금융' }],
      [
        'save-query-answer',
        expect.objectContaining({
          slackRequestId: 'request-1',
          threadContextPatch: expect.objectContaining({
            summary: '미래금융 영업기회 조회를 마쳤다.',
          }),
        }),
      ],
      [
        'post-slack-reply',
        {
          slackRequestId: 'request-1',
          text: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
        },
      ],
    ]);

    const firstCall = runCodexDecision.mock.calls[0][0];
    expect(firstCall.prompt).toContain('load-thread-context');
    expect(firstCall.prompt).toContain('recentTurnsJson');
    expect(firstCall.prompt).toContain('pendingApprovalJson');
  });

  it('wraps load-slack-request payloads and prompts a structured tool catalog before accepting a query answer', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'query',
        message:
          '현재 사용 가능한 도구가 unavailable하다고 말하지 않고, 먼저 조회 결과를 더 모으겠습니다.',
      })
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'search-opportunities',
        payload: {
          query: '미래금융',
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'query',
        message: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
        threadContextPatch: {
          assistantTurn: {
            text: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
            outcome: 'query',
          },
          summary: '미래금융 영업기회 조회를 마쳤다.',
          selectedEntities: {
            opportunityIds: ['opportunity-1'],
          },
          lastQuerySnapshot: {
            requestId: 'request-1',
            items: [
              {
                id: 'opportunity-1',
                kind: 'opportunity',
                label: '미래금융 VDI',
                order: 0,
                summary: 'NEGOTIATION',
              },
            ],
          },
          pendingApproval: null,
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-1',
      toolClient: buildToolClient(toolCalls),
      runCodexDecision,
    });

    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-1' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-1' }],
      ['search-opportunities', { query: '미래금융' }],
      [
        'save-query-answer',
        expect.objectContaining({
          reply: {
            text: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
          },
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'query_answer',
              provider: 'codex',
              succeeded: true,
            },
          },
          slackRequestId: 'request-1',
          threadContextPatch: expect.objectContaining({
            summary: '미래금융 영업기회 조회를 마쳤다.',
          }),
        }),
      ],
      [
        'post-slack-reply',
        {
          slackRequestId: 'request-1',
          text: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
        },
      ],
    ]);

    expect(runCodexDecision).toHaveBeenCalledTimes(3);

    const firstCall = runCodexDecision.mock.calls[0][0];
    expect(firstCall.slackRequest).toEqual({
      id: 'request-1',
      normalizedText: '미래금융 영업기회 보여줘',
      rawText: '@Daou-CRM-slack 미래금융 영업기회 보여줘',
    });
    expect(firstCall.prompt).toContain('"modelVisibleTools"');
    expect(firstCall.prompt).toContain('search-opportunities');
    expect(firstCall.prompt).toContain('create-record');
    expect(firstCall.prompt).toContain('create-lead-package');
    expect(firstCall.prompt).toContain('inputSchema');
    expect(firstCall.prompt).toContain('policy');
    expect(firstCall.prompt).toContain('load-slack-request');
    expect(firstCall.prompt).toContain(
      'You act as a Korean enterprise software sales strategist and CRM analyst for Daou Data.',
    );
    expect(firstCall.prompt).toContain(
      'If the enterprise-sales skill is available, use it to reason about champions, stakeholders, business outcomes, indecision, procurement friction, enablement gaps, and partner strategy.',
    );
    expect(firstCall.prompt).toContain('Response style:');
    expect(firstCall.prompt).toContain(
      '- For analytical, strategy, briefing, summary, or recommendation requests, use short markdown sections and flat bullet lists.',
    );

    expect(result).toEqual({
      kind: 'query',
      slackRequestId: 'request-1',
      answer: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
    });
  });

  it('stores approval-gated write drafts after update flows', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'update-record',
        payload: {
          kind: 'opportunity',
          lookup: {
            id: 'opportunity-1',
          },
          data: {
            stage: 'NEGOTIATION',
          },
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '영업기회 수정 승인을 요청합니다.',
        draft: {
          summary: '영업기회 수정 초안',
          confidence: 0.92,
          sourceText: '미래금융 VDI 기회 단계를 수정해줘',
          actions: [
            {
              kind: 'opportunity',
              operation: 'update',
              lookup: {
                id: 'opportunity-1',
              },
              data: {
                stage: 'NEGOTIATION',
              },
            },
          ],
          warnings: [],
        },
        threadContextPatch: {
          assistantTurn: {
            text: '영업기회 수정 승인을 요청합니다.',
            outcome: 'write_draft',
          },
          summary: '미래금융 VDI 기회 수정 승인을 기다린다.',
          selectedEntities: {
            opportunityIds: ['opportunity-1'],
          },
          lastQuerySnapshot: null,
          pendingApproval: {
            sourceSlackRequestId: 'request-2',
            summary: '영업기회 수정 초안',
            actions: [
              {
                kind: 'opportunity',
                operation: 'update',
                lookup: {
                  id: 'opportunity-1',
                },
                data: {
                  stage: 'NEGOTIATION',
                },
              },
            ],
            review: null,
            status: 'AWAITING_CONFIRMATION',
          },
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-2',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-2',
                normalizedText: '미래금융 VDI 기회 단계를 수정해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-2',
                summaryJson: {
                  text: '',
                },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'update-record') {
            return {
              ok: true,
              actionResult: {
                kind: 'opportunity',
                operation: 'update',
                id: 'opportunity-1',
              },
            };
          }

          if (endpoint === 'save-write-draft') {
            return {
              id: 'request-2',
              processingStatus: 'AWAITING_CONFIRMATION',
            };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-2' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-2' }],
      [
        'update-record',
        {
          kind: 'opportunity',
          lookup: {
            id: 'opportunity-1',
          },
          data: {
            stage: 'NEGOTIATION',
          },
        },
      ],
      [
        'save-write-draft',
        {
          slackRequestId: 'request-2',
          draft: {
            summary: '영업기회 수정 초안',
            confidence: 0.92,
            sourceText: '미래금융 VDI 기회 단계를 수정해줘',
            actions: [
              {
                kind: 'opportunity',
                operation: 'update',
                lookup: {
                  id: 'opportunity-1',
                },
                data: {
                  stage: 'NEGOTIATION',
                },
              },
            ],
            warnings: [],
          },
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'write_draft',
              provider: 'codex',
              succeeded: true,
            },
          },
          threadContextPatch: expect.objectContaining({
            summary: '미래금융 VDI 기회 수정 승인을 기다린다.',
          }),
        },
      ],
    ]);

    expect(result).toEqual({
      kind: 'write_draft',
      slackRequestId: 'request-2',
      draft: {
        summary: '영업기회 수정 초안',
        confidence: 0.92,
        sourceText: '미래금융 VDI 기회 단계를 수정해줘',
        actions: [
          {
            kind: 'opportunity',
            operation: 'update',
            lookup: {
              id: 'opportunity-1',
            },
            data: {
              stage: 'NEGOTIATION',
            },
          },
        ],
        warnings: [],
      },
    });
  });

  it('uses create-lead-package for lead registration requests and persists an approval draft', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'create-lead-package',
        payload: {
          companyName: '서광건설엔지니어링',
          contactName: '박성훈',
          primaryEmail: 'sh.park@seogwang-demo.co.kr',
          solutionName: 'Autodesk AEC Collection',
          sourceText: 'CRM에 신규 리드로 등록해줘',
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '신규 리드 등록 승인 초안을 준비했습니다.',
        draft: {
          summary: '서광건설엔지니어링 신규 리드 등록 초안',
          confidence: 0.93,
          sourceText: 'CRM에 신규 리드로 등록해줘',
          actions: [],
          warnings: [],
        },
        threadContextPatch: {
          assistantTurn: {
            text: '신규 리드 등록 승인 초안을 준비했습니다.',
            outcome: 'write_draft',
          },
          summary: '서광건설엔지니어링 리드 등록 승인을 기다린다.',
          selectedEntities: {},
          lastQuerySnapshot: null,
          pendingApproval: {
            sourceSlackRequestId: 'request-lead-package',
            summary: '서광건설엔지니어링 신규 리드 등록 초안',
            actions: [
              {
                kind: 'company',
                operation: 'create',
                data: {
                  name: '서광건설엔지니어링',
                },
              },
            ],
            review: null,
            status: 'AWAITING_CONFIRMATION',
          },
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-lead-package',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-lead-package',
                normalizedText: 'CRM에 신규 리드로 등록해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-lead-package',
                summaryJson: {
                  text: '',
                },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'create-lead-package') {
            return {
              ok: true,
              draft: {
                summary: '서광건설엔지니어링 신규 리드 등록 초안',
                confidence: 0.93,
                sourceText: 'CRM에 신규 리드로 등록해줘',
                actions: [
                  {
                    kind: 'company',
                    operation: 'create',
                    data: {
                      name: '서광건설엔지니어링',
                    },
                  },
                  {
                    kind: 'person',
                    operation: 'create',
                    data: {
                      name: '박성훈',
                      companyName: '서광건설엔지니어링',
                    },
                  },
                ],
                warnings: [],
                review: {
                  overview: '리드 등록 패키지 초안',
                  opinion: '회사와 담당자 중복 여부를 확인하세요.',
                  items: [],
                },
              },
              plannedRecords: {
                company: {
                  decision: 'CREATE',
                  label: '서광건설엔지니어링',
                },
              },
            };
          }

          if (endpoint === 'save-write-draft') {
            return {
              id: 'request-lead-package',
              processingStatus: 'AWAITING_CONFIRMATION',
            };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-lead-package' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-lead-package' }],
      [
        'create-lead-package',
        {
          companyName: '서광건설엔지니어링',
          contactName: '박성훈',
          primaryEmail: 'sh.park@seogwang-demo.co.kr',
          solutionName: 'Autodesk AEC Collection',
          sourceText: 'CRM에 신규 리드로 등록해줘',
        },
      ],
      [
        'save-write-draft',
        {
          slackRequestId: 'request-lead-package',
          draft: expect.objectContaining({
            summary: '서광건설엔지니어링 신규 리드 등록 초안',
            actions: expect.arrayContaining([
              expect.objectContaining({ kind: 'company', operation: 'create' }),
              expect.objectContaining({ kind: 'person', operation: 'create' }),
            ]),
          }),
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'write_draft',
              provider: 'codex',
              succeeded: true,
            },
          },
          threadContextPatch: expect.objectContaining({
            summary: '서광건설엔지니어링 리드 등록 승인을 기다린다.',
          }),
        },
      ],
    ]);

    expect(result).toEqual({
      kind: 'write_draft',
      slackRequestId: 'request-lead-package',
      draft: expect.objectContaining({
        summary: '서광건설엔지니어링 신규 리드 등록 초안',
        actions: expect.arrayContaining([
          expect.objectContaining({ kind: 'company', operation: 'create' }),
          expect.objectContaining({ kind: 'person', operation: 'create' }),
        ]),
      }),
    });
  });

  it('does not allow create-record mutations after a lead package preview', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'create-lead-package',
        payload: {
          companyName: '서광건설엔지니어링',
          sourceText: 'CRM에 신규 리드로 등록해줘',
        },
      })
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'create-record',
        payload: {
          kind: 'company',
          data: {
            name: '서광건설엔지니어링',
          },
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '신규 리드 등록 승인 초안을 준비했습니다.',
        draft: {
          summary: '모델 초안',
          confidence: 0.5,
          sourceText: 'CRM에 신규 리드로 등록해줘',
          actions: [],
          warnings: [],
        },
        threadContextPatch: {
          assistantTurn: {
            text: '신규 리드 등록 승인 초안을 준비했습니다.',
            outcome: 'write_draft',
          },
          summary: '리드 등록 승인을 기다린다.',
          selectedEntities: {},
          lastQuerySnapshot: null,
          pendingApproval: {
            sourceSlackRequestId: 'request-lead-guard',
            summary: '리드 등록 초안',
            actions: [],
            review: null,
            status: 'AWAITING_CONFIRMATION',
          },
        },
      });

    await processSlackRequestWithCodex({
      slackRequestId: 'request-lead-guard',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-lead-guard',
                normalizedText: 'CRM에 신규 리드로 등록해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-lead-guard',
                summaryJson: { text: '' },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'create-lead-package') {
            return {
              ok: true,
              draft: {
                summary: '서광건설엔지니어링 신규 리드 등록 초안',
                confidence: 0.93,
                sourceText: 'CRM에 신규 리드로 등록해줘',
                actions: [
                  {
                    kind: 'opportunity',
                    operation: 'create',
                    data: {
                      name: '서광건설엔지니어링 신규 리드',
                    },
                  },
                ],
                warnings: [],
              },
            };
          }

          if (endpoint === 'save-write-draft') {
            return {
              id: 'request-lead-guard',
              processingStatus: 'AWAITING_CONFIRMATION',
            };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(toolCalls).not.toContainEqual([
      'create-record',
      expect.anything(),
    ]);
    expect(toolCalls).toContainEqual([
      'save-write-draft',
      expect.objectContaining({
        draft: expect.objectContaining({
          summary: '서광건설엔지니어링 신규 리드 등록 초안',
          actions: [
            {
              kind: 'opportunity',
              operation: 'create',
              data: {
                name: '서광건설엔지니어링 신규 리드',
              },
            },
          ],
        }),
      }),
    ]);
  });

  it('uses the lead package tool draft instead of model-supplied draft actions', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'create-lead-package',
        payload: {
          companyName: '서광건설엔지니어링',
          sourceText: 'CRM에 신규 리드로 등록해줘',
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '신규 리드 등록 승인 초안을 준비했습니다.',
        draft: {
          summary: '모델이 덮어쓴 초안',
          confidence: 0.1,
          sourceText: 'CRM에 신규 리드로 등록해줘',
          actions: [
            {
              kind: 'company',
              operation: 'create',
              data: {
                name: '잘못된 회사',
              },
            },
          ],
          warnings: ['모델 경고'],
        },
        threadContextPatch: {
          assistantTurn: {
            text: '신규 리드 등록 승인 초안을 준비했습니다.',
            outcome: 'write_draft',
          },
          summary: '리드 등록 승인을 기다린다.',
          selectedEntities: {},
          lastQuerySnapshot: null,
          pendingApproval: {
            sourceSlackRequestId: 'request-lead-grounded',
            summary: '리드 등록 초안',
            actions: [],
            review: null,
            status: 'AWAITING_CONFIRMATION',
          },
        },
      });

    await processSlackRequestWithCodex({
      slackRequestId: 'request-lead-grounded',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-lead-grounded',
                normalizedText: 'CRM에 신규 리드로 등록해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-lead-grounded',
                summaryJson: { text: '' },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'create-lead-package') {
            return {
              ok: true,
              draft: {
                summary: '서광건설엔지니어링 신규 리드 등록 초안',
                confidence: 0.93,
                sourceText: 'CRM에 신규 리드로 등록해줘',
                actions: [
                  {
                    kind: 'opportunity',
                    operation: 'create',
                    data: {
                      name: '서광건설엔지니어링 신규 리드',
                    },
                  },
                ],
                warnings: [],
                review: {
                  overview: '리드 등록 패키지 초안',
                  opinion: '승인 후 생성합니다.',
                  items: [],
                },
              },
            };
          }

          if (endpoint === 'save-write-draft') {
            return {
              id: 'request-lead-grounded',
              processingStatus: 'AWAITING_CONFIRMATION',
            };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(toolCalls).toContainEqual([
      'save-write-draft',
      expect.objectContaining({
        draft: {
          summary: '서광건설엔지니어링 신규 리드 등록 초안',
          confidence: 0.93,
          sourceText: 'CRM에 신규 리드로 등록해줘',
          actions: [
            {
              kind: 'opportunity',
              operation: 'create',
              data: {
                name: '서광건설엔지니어링 신규 리드',
              },
            },
          ],
          warnings: [],
          review: {
            overview: '리드 등록 패키지 초안',
            opinion: '승인 후 생성합니다.',
            items: [],
          },
        },
      }),
    ]);
  });

  it('rejects write_draft finals that are not grounded in update/delete tool results', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '영업기회 수정 승인을 요청합니다.',
        draft: {
          summary: '근거 없는 수정 초안',
          confidence: 0.9,
          sourceText: '영업기회 수정해줘',
          actions: [],
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'update-record',
        payload: {
          kind: 'opportunity',
          lookup: {
            id: 'opportunity-1',
          },
          data: {
            stage: 'NEGOTIATION',
          },
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '영업기회 수정 승인을 요청합니다.',
        draft: {
          summary: '영업기회 수정 초안',
          confidence: 0.92,
          sourceText: '미래금융 VDI 기회 단계를 수정해줘',
          actions: [],
          warnings: [],
        },
        threadContextPatch: {
          assistantTurn: {
            text: '영업기회 수정 승인을 요청합니다.',
            outcome: 'write_draft',
          },
          summary: '미래금융 VDI 기회 수정 승인을 기다린다.',
          selectedEntities: {
            opportunityIds: ['opportunity-1'],
          },
          lastQuerySnapshot: null,
          pendingApproval: {
            sourceSlackRequestId: 'request-2b',
            summary: '영업기회 수정 초안',
            actions: [
              {
                kind: 'opportunity',
                operation: 'update',
                lookup: {
                  id: 'opportunity-1',
                },
                data: {
                  stage: 'NEGOTIATION',
                },
              },
            ],
            review: {
              overview: '영업기회 수정 초안',
              opinion: '승인 전에 수정/삭제 대상과 변경 내용을 확인하세요.',
              items: [
                {
                  kind: 'opportunity',
                  decision: 'UPDATE',
                  target: '미래금융 VDI',
                  matchedRecord: '미래금융 VDI',
                  fields: [{ key: 'stage', value: 'NEGOTIATION' }],
                },
              ],
            },
            status: 'AWAITING_CONFIRMATION',
          },
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-2b',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-2b',
                normalizedText: '미래금융 VDI 기회 단계를 수정해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-2b',
                summaryJson: {
                  text: '',
                },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'update-record') {
            return {
              ok: true,
              plannedAction: {
                kind: 'opportunity',
                operation: 'update',
                lookup: {
                  id: 'opportunity-1',
                },
                data: {
                  stage: 'NEGOTIATION',
                },
              },
              matchedRecord: {
                id: 'opportunity-1',
                label: '미래금융 VDI',
              },
              reviewItem: {
                kind: 'opportunity',
                decision: 'UPDATE',
                target: '미래금융 VDI',
                matchedRecord: '미래금융 VDI',
                fields: [{ key: 'stage', value: 'NEGOTIATION' }],
              },
            };
          }

          if (endpoint === 'save-write-draft') {
            return {
              id: 'request-2b',
              processingStatus: 'AWAITING_CONFIRMATION',
            };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(runCodexDecision).toHaveBeenCalledTimes(3);
    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-2b' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-2b' }],
      [
        'update-record',
        {
          kind: 'opportunity',
          lookup: {
            id: 'opportunity-1',
          },
          data: {
            stage: 'NEGOTIATION',
          },
        },
      ],
      [
        'save-write-draft',
        {
          slackRequestId: 'request-2b',
          draft: {
            summary: '영업기회 수정 초안',
            confidence: 0.92,
            sourceText: '미래금융 VDI 기회 단계를 수정해줘',
            actions: [
              {
                kind: 'opportunity',
                operation: 'update',
                lookup: {
                  id: 'opportunity-1',
                },
                data: {
                  stage: 'NEGOTIATION',
                },
              },
            ],
            warnings: [],
            review: {
              overview: '영업기회 수정 초안',
              opinion: '승인 전에 수정/삭제 대상과 변경 내용을 확인하세요.',
              items: [
                {
                  kind: 'opportunity',
                  decision: 'UPDATE',
                  target: '미래금융 VDI',
                  matchedRecord: '미래금융 VDI',
                  fields: [{ key: 'stage', value: 'NEGOTIATION' }],
                },
              ],
            },
          },
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'write_draft',
              provider: 'codex',
              succeeded: true,
            },
          },
          threadContextPatch: expect.objectContaining({
            summary: '미래금융 VDI 기회 수정 승인을 기다린다.',
          }),
        },
      ],
    ]);
    expect(result).toEqual({
      kind: 'write_draft',
      slackRequestId: 'request-2b',
      draft: {
        summary: '영업기회 수정 초안',
        confidence: 0.92,
        sourceText: '미래금융 VDI 기회 단계를 수정해줘',
        actions: [
          {
            kind: 'opportunity',
            operation: 'update',
            lookup: {
              id: 'opportunity-1',
            },
            data: {
              stage: 'NEGOTIATION',
            },
          },
        ],
        warnings: [],
        review: {
          overview: '영업기회 수정 초안',
          opinion: '승인 전에 수정/삭제 대상과 변경 내용을 확인하세요.',
          items: [
            {
              kind: 'opportunity',
              decision: 'UPDATE',
              target: '미래금융 VDI',
              matchedRecord: '미래금융 VDI',
              fields: [{ key: 'stage', value: 'NEGOTIATION' }],
            },
          ],
        },
      },
    });
  });

  it('executes create tools immediately and stores an applied execution report', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'create-record',
        payload: {
          kind: 'company',
          data: {
            name: '미래금융',
          },
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'applied',
        message: '미래금융 회사를 생성했습니다.',
        threadContextPatch: {
          assistantTurn: {
            text: '미래금융 회사를 생성했습니다.',
            outcome: 'applied',
          },
          summary: '미래금융 회사를 생성했다.',
          selectedEntities: {
            companyIds: ['company-1'],
          },
          lastQuerySnapshot: null,
          pendingApproval: null,
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-create-company',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-create-company',
                normalizedText: '미래금융 회사 생성해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-create-company',
                summaryJson: {
                  text: '',
                },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'create-record') {
            return {
              ok: true,
              actionResult: {
                kind: 'company',
                operation: 'create',
                id: 'company-1',
              },
            };
          }

          if (endpoint === 'save-applied-result') {
            return {
              id: 'request-create-company',
              processingStatus: 'APPLIED',
            };
          }

          if (endpoint === 'post-slack-reply') {
            return { ok: true };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-create-company' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-create-company' }],
      [
        'create-record',
        {
          kind: 'company',
          data: {
            name: '미래금융',
          },
        },
      ],
      [
        'save-applied-result',
        {
          reply: {
            text: '미래금융 회사를 생성했습니다.',
          },
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'applied',
              provider: 'codex',
              succeeded: true,
            },
            executedTools: [
              {
                result: {
                  actionResult: {
                    id: 'company-1',
                    kind: 'company',
                    operation: 'create',
                  },
                  ok: true,
                },
                toolName: 'create-record',
              },
            ],
          },
          slackRequestId: 'request-create-company',
          threadContextPatch: expect.objectContaining({
            summary: '미래금융 회사를 생성했다.',
          }),
        },
      ],
      [
        'post-slack-reply',
        {
          slackRequestId: 'request-create-company',
          text: '미래금융 회사를 생성했습니다.',
        },
      ],
    ]);

    expect(result).toEqual({
      kind: 'applied',
      slackRequestId: 'request-create-company',
      message: '미래금융 회사를 생성했습니다.',
    });
  });

  it('rejects write_draft finals after immediate create mutations have already run', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'create-record',
        payload: {
          kind: 'company',
          data: {
            name: '미래금융',
          },
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '초안을 만들었습니다.',
        draft: {
          summary: '금지된 초안',
          confidence: 0.9,
          sourceText: '미래금융 회사를 생성해줘',
          actions: [],
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'applied',
        message: '미래금융 회사를 생성했습니다.',
        threadContextPatch: {
          assistantTurn: {
            text: '미래금융 회사를 생성했습니다.',
            outcome: 'applied',
          },
          summary: '미래금융 회사를 생성했다.',
          selectedEntities: {
            companyIds: ['company-1'],
          },
          lastQuerySnapshot: null,
          pendingApproval: null,
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-create-guard',
      toolClient: {
        callTool: async (
          endpoint: string,
          payload: Record<string, unknown> = {},
        ) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              ok: true,
              slackRequest: {
                id: 'request-create-guard',
                normalizedText: '미래금융 회사 생성해줘',
              },
            };
          }

          if (endpoint === 'get-tool-catalog') {
            return toolCatalogResponse;
          }

          if (endpoint === 'load-thread-context') {
            return {
              ok: true,
              threadContext: {
                threadKey: 'T1:C1:thread-create-guard',
                summaryJson: {
                  text: '',
                },
                recentTurnsJson: [],
                contextJson: {
                  selectedCompanyIds: [],
                  selectedPersonIds: [],
                  selectedOpportunityIds: [],
                  selectedLicenseIds: [],
                  lastQuerySnapshot: null,
                },
                pendingApprovalJson: null,
                lastSlackRequestId: null,
                lastRepliedAt: null,
              },
            };
          }

          if (endpoint === 'create-record') {
            return {
              ok: true,
              actionResult: {
                kind: 'company',
                operation: 'create',
                id: 'company-1',
              },
            };
          }

          if (endpoint === 'save-applied-result') {
            return {
              id: 'request-create-guard',
              processingStatus: 'APPLIED',
            };
          }

          if (endpoint === 'post-slack-reply') {
            return { ok: true };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(runCodexDecision).toHaveBeenCalledTimes(3);
    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-create-guard' }],
      ['get-tool-catalog', {}],
      ['load-thread-context', { slackRequestId: 'request-create-guard' }],
      [
        'create-record',
        {
          kind: 'company',
          data: {
            name: '미래금융',
          },
        },
      ],
      [
        'save-applied-result',
        {
          reply: {
            text: '미래금융 회사를 생성했습니다.',
          },
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'applied',
              provider: 'codex',
              succeeded: true,
            },
            executedTools: [
              {
                result: {
                  actionResult: {
                    id: 'company-1',
                    kind: 'company',
                    operation: 'create',
                  },
                  ok: true,
                },
                toolName: 'create-record',
              },
            ],
          },
          slackRequestId: 'request-create-guard',
          threadContextPatch: expect.objectContaining({
            summary: '미래금융 회사를 생성했다.',
          }),
        },
      ],
      [
        'post-slack-reply',
        {
          slackRequestId: 'request-create-guard',
          text: '미래금융 회사를 생성했습니다.',
        },
      ],
    ]);
    expect(result).toEqual({
      kind: 'applied',
      slackRequestId: 'request-create-guard',
      message: '미래금융 회사를 생성했습니다.',
    });
  });

  it('rejects direct internal tool calls from the model', async () => {
    const toolClient = {
      callTool: vi.fn(async (endpoint: string) => {
        if (endpoint === 'load-slack-request') {
          return {
            ok: true,
            slackRequest: {
              id: 'request-3',
              normalizedText: '미래금융 VDI 기회 추가',
            },
          };
        }

        if (endpoint === 'get-tool-catalog') {
          return toolCatalogResponse;
        }

        if (endpoint === 'load-thread-context') {
          return {
            ok: true,
            threadContext: {
              threadKey: 'T1:C1:thread-3',
              summaryJson: {
                text: '',
              },
              recentTurnsJson: [],
              contextJson: {
                selectedCompanyIds: [],
                selectedPersonIds: [],
                selectedOpportunityIds: [],
                selectedLicenseIds: [],
                lastQuerySnapshot: null,
              },
              pendingApprovalJson: null,
              lastSlackRequestId: null,
              lastRepliedAt: null,
            },
          };
        }

        return { ok: true };
      }),
    };

    await expect(
      processSlackRequestWithCodex({
        slackRequestId: 'request-3',
        toolClient,
        maxSteps: 1,
        runCodexDecision: vi.fn().mockResolvedValueOnce({
          kind: 'tool_call',
          endpoint: 'save-query-answer',
          payload: {
            slackRequestId: 'request-3',
          },
        }),
      }),
    ).rejects.toThrow('Disallowed Codex tool call');

    expect(toolClient.callTool).toHaveBeenCalledWith('load-slack-request', {
      slackRequestId: 'request-3',
    });
    expect(toolClient.callTool).not.toHaveBeenCalledWith(
      'save-query-answer',
      expect.anything(),
    );
  });

  it('accepts final decisions without an explicit kind when mode is provided', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-kindless-final',
      toolClient: buildToolClient(toolCalls),
      runCodexDecision: vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'tool_call',
          toolName: 'search-opportunities',
          input: {
            query: '미래금융',
          },
        })
        .mockResolvedValueOnce({
          mode: 'query',
          message: '미래금융 관련 영업기회를 정리했습니다.',
          threadContextPatch: {
            assistantTurn: {
              text: '미래금융 관련 영업기회를 정리했습니다.',
              outcome: 'query',
            },
            summary: '미래금융 영업기회 조회를 마쳤다.',
            selectedEntities: {
              opportunityIds: ['opportunity-1'],
            },
            lastQuerySnapshot: {
              requestId: 'request-kindless-final',
              items: [
                {
                  id: 'opportunity-1',
                  kind: 'opportunity',
                  label: '미래금융 VDI',
                  order: 0,
                },
              ],
            },
            pendingApproval: null,
          },
        }),
    });

    expect(result).toEqual({
      kind: 'query',
      slackRequestId: 'request-kindless-final',
      answer: '미래금융 관련 영업기회를 정리했습니다.',
    });
    expect(toolCalls).toContainEqual([
      'save-query-answer',
      expect.objectContaining({
        slackRequestId: 'request-kindless-final',
        reply: {
          text: '미래금융 관련 영업기회를 정리했습니다.',
        },
      }),
    ]);
  });
});
