import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, mutation, findSlackRequestsByThread } = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  findSlackRequestsByThread: vi.fn(),
}));

vi.mock('src/utils/core-client', () => ({
  createCoreClient: () => ({
    query,
    mutation,
  }),
}));

vi.mock('src/utils/slack-intake-service', () => ({
  findSlackRequestsByThread,
}));

import {
  applyThreadContextPatchToSlackRequest,
  buildSlackThreadKey,
  loadOrCreateThreadContextForSlackRequest,
} from 'src/utils/slack-thread-context-service';

const slackRequest = {
  id: 'request-2',
  name: 'APP_MENTION - test',
  slackTeamId: 'T1',
  slackChannelId: 'C1',
  slackThreadTs: 'thread-1',
  slackMessageTs: 'thread-1',
  slackUserId: 'U1',
  sourceType: 'APP_MENTION' as const,
  slackResponseUrl: null,
  rawText: '@Daou-CRM-slack 그거 단계만 바꿔줘',
  normalizedText: '그거 단계만 바꿔줘',
  intentType: 'WRITE_DRAFT' as const,
  processingStatus: 'RECEIVED' as const,
  confidence: null,
  draftJson: null,
  resultJson: null,
  errorMessage: null,
  dedupeKey: 'APP_MENTION:T1:C1:thread-1:event-2',
  approvedByWorkspaceMemberId: null,
  receivedAt: '2026-04-18T11:20:00.000Z',
  lastProcessedAt: null,
};

describe('slack thread context service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a stable thread key from team, channel, and thread ts', () => {
    expect(buildSlackThreadKey(slackRequest)).toBe('T1:C1:thread-1');
  });

  it('creates a missing thread context by recovering recent same-thread requests', async () => {
    query.mockResolvedValueOnce({
      slackThreadContexts: {
        edges: [],
      },
    });
    findSlackRequestsByThread.mockResolvedValueOnce([
      {
        ...slackRequest,
        id: 'request-1',
        rawText: '@Daou-CRM-slack 미래금융 영업기회 보여줘',
        normalizedText: '미래금융 영업기회 보여줘',
        processingStatus: 'ANSWERED',
        resultJson: {
          reply: {
            text: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
          },
          threadContextPatch: {
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
          },
        },
        lastProcessedAt: '2026-04-18T11:19:00.000Z',
      },
    ]);
    mutation.mockResolvedValueOnce({
      createSlackThreadContext: {
        id: 'thread-context-1',
        name: 'T1:C1:thread-1',
        slackTeamId: 'T1',
        slackChannelId: 'C1',
        slackThreadTs: 'thread-1',
        threadKey: 'T1:C1:thread-1',
        summaryJson: {
          text: '미래금융 영업기회 조회를 마쳤다.',
        },
        recentTurnsJson: [
          {
            requestId: 'request-1',
            userText: '미래금융 영업기회 보여줘',
            assistantText: '미래금융 영업기회는 NEGOTIATION 단계입니다.',
            outcome: 'query',
          },
        ],
        contextJson: {
          selectedCompanyIds: [],
          selectedPersonIds: [],
          selectedOpportunityIds: ['opportunity-1'],
          selectedLicenseIds: [],
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
        },
        pendingApprovalJson: null,
        lastSlackRequestId: 'request-1',
        lastRepliedAt: null,
      },
    });

    const result = await loadOrCreateThreadContextForSlackRequest(slackRequest);

    expect(findSlackRequestsByThread).toHaveBeenCalledWith({
      slackTeamId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: 'thread-1',
    });
    expect(mutation).toHaveBeenCalledWith({
      createSlackThreadContext: {
        __args: {
          data: expect.objectContaining({
            threadKey: 'T1:C1:thread-1',
            summaryJson: {
              text: '미래금융 영업기회 조회를 마쳤다.',
            },
          }),
        },
        contextJson: true,
        id: true,
        lastRepliedAt: true,
        lastSlackRequestId: true,
        name: true,
        pendingApprovalJson: true,
        recentTurnsJson: true,
        slackChannelId: true,
        slackTeamId: true,
        slackThreadTs: true,
        summaryJson: true,
        threadKey: true,
      },
    });
    expect(result.contextJson.selectedOpportunityIds).toEqual(['opportunity-1']);
    expect(result.recentTurnsJson).toHaveLength(1);
  });

  it('preserves pending approval for query answers but clears it after applied replies', async () => {
    query.mockResolvedValue({
      slackThreadContexts: {
        edges: [
          {
            node: {
              id: 'thread-context-1',
              name: 'T1:C1:thread-1',
              slackTeamId: 'T1',
              slackChannelId: 'C1',
              slackThreadTs: 'thread-1',
              threadKey: 'T1:C1:thread-1',
              summaryJson: {
                text: '이전 승인 대기가 있다.',
              },
              recentTurnsJson: Array.from({ length: 6 }, (_, index) => ({
                requestId: `request-${index}`,
                userText: `user-${index}`,
                assistantText: `assistant-${index}`,
                outcome: 'query',
              })),
              contextJson: {
                selectedCompanyIds: [],
                selectedPersonIds: [],
                selectedOpportunityIds: ['opportunity-1'],
                selectedLicenseIds: [],
                lastQuerySnapshot: null,
              },
              pendingApprovalJson: {
                sourceSlackRequestId: 'request-1',
                summary: '기존 수정 초안',
                actions: [],
                review: null,
                status: 'AWAITING_CONFIRMATION',
              },
              lastSlackRequestId: 'request-1',
              lastRepliedAt: '2026-04-18T11:19:00.000Z',
            },
          },
        ],
      },
    });
    mutation.mockResolvedValueOnce({
      updateSlackThreadContext: {
        id: 'thread-context-1',
        name: 'T1:C1:thread-1',
        slackTeamId: 'T1',
        slackChannelId: 'C1',
        slackThreadTs: 'thread-1',
        threadKey: 'T1:C1:thread-1',
        summaryJson: {
          text: '조회 응답을 마쳤다.',
        },
        recentTurnsJson: Array.from({ length: 6 }, (_, index) => ({
          requestId: `request-${index + 1}`,
          userText: `user-${index + 1}`,
          assistantText: `assistant-${index + 1}`,
          outcome: 'query',
        })),
        contextJson: {
          selectedCompanyIds: [],
          selectedPersonIds: [],
          selectedOpportunityIds: ['opportunity-1'],
          selectedLicenseIds: [],
          lastQuerySnapshot: null,
        },
        pendingApprovalJson: {
          sourceSlackRequestId: 'request-1',
          summary: '기존 수정 초안',
          actions: [],
          review: null,
          status: 'AWAITING_CONFIRMATION',
        },
        lastSlackRequestId: 'request-2',
        lastRepliedAt: '2026-04-18T11:20:00.000Z',
      },
    });

    await applyThreadContextPatchToSlackRequest({
      slackRequest,
      patch: {
        assistantTurn: {
          text: '조회 응답입니다.',
          outcome: 'query',
        },
        summary: '조회 응답을 마쳤다.',
        selectedEntities: {
          opportunityIds: ['opportunity-1'],
        },
        lastQuerySnapshot: null,
        pendingApproval: null,
      },
    });

    expect(mutation).toHaveBeenCalledWith({
      updateSlackThreadContext: {
        __args: {
          id: 'thread-context-1',
          data: expect.objectContaining({
            pendingApprovalJson: expect.objectContaining({
              sourceSlackRequestId: 'request-1',
            }),
            recentTurnsJson: expect.stringContaining('"requestId":"request-2"'),
          }),
        },
        contextJson: true,
        id: true,
        lastRepliedAt: true,
        lastSlackRequestId: true,
        name: true,
        pendingApprovalJson: true,
        recentTurnsJson: true,
        slackChannelId: true,
        slackTeamId: true,
        slackThreadTs: true,
        summaryJson: true,
        threadKey: true,
      },
    });

    mutation.mockResolvedValueOnce({
      updateSlackThreadContext: {
        id: 'thread-context-1',
        name: 'T1:C1:thread-1',
        slackTeamId: 'T1',
        slackChannelId: 'C1',
        slackThreadTs: 'thread-1',
        threadKey: 'T1:C1:thread-1',
        summaryJson: {
          text: 'CRM 반영을 마쳤다.',
        },
        recentTurnsJson: [],
        contextJson: {
          selectedCompanyIds: ['company-1'],
          selectedPersonIds: [],
          selectedOpportunityIds: ['opportunity-1'],
          selectedLicenseIds: [],
          lastQuerySnapshot: null,
        },
        pendingApprovalJson: null,
        lastSlackRequestId: 'request-2',
        lastRepliedAt: '2026-04-18T11:21:00.000Z',
      },
    });

    await applyThreadContextPatchToSlackRequest({
      slackRequest,
      patch: {
        assistantTurn: {
          text: 'CRM 반영을 마쳤습니다.',
          outcome: 'applied',
        },
        summary: 'CRM 반영을 마쳤다.',
        selectedEntities: {
          companyIds: ['company-1'],
        },
        lastQuerySnapshot: null,
        pendingApproval: null,
      },
    });

    expect(mutation).toHaveBeenLastCalledWith({
      updateSlackThreadContext: {
        __args: {
          id: 'thread-context-1',
          data: expect.objectContaining({
            pendingApprovalJson: null,
          }),
        },
        contextJson: true,
        id: true,
        lastRepliedAt: true,
        lastSlackRequestId: true,
        name: true,
        pendingApprovalJson: true,
        recentTurnsJson: true,
        slackChannelId: true,
        slackTeamId: true,
        slackThreadTs: true,
        summaryJson: true,
        threadKey: true,
      },
    });
  });
});
