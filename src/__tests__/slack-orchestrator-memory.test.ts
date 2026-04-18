import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findSlackRequestById,
  updateSlackRequest,
  postSlackReplyForRequest,
  applyApprovedDraft,
  buildApplyResultJson,
  summarizeApplyResult,
  applyThreadContextPatchToSlackRequest,
} = vi.hoisted(() => ({
  findSlackRequestById: vi.fn(),
  updateSlackRequest: vi.fn(),
  postSlackReplyForRequest: vi.fn(),
  applyApprovedDraft: vi.fn(),
  buildApplyResultJson: vi.fn(),
  summarizeApplyResult: vi.fn(),
  applyThreadContextPatchToSlackRequest: vi.fn(),
}));

vi.mock('src/utils/slack-intake-service', () => ({
  findSlackRequestById,
  updateSlackRequest,
}));

vi.mock('src/utils/slack-api', () => ({
  postSlackReplyForRequest,
}));

vi.mock('src/utils/crm-write', () => ({
  applyApprovedDraft,
  buildApplyResultJson,
  summarizeApplyResult,
  createOperationalTask: vi.fn(),
}));

vi.mock('src/utils/intelligence', () => ({
  classifySlackTextWithDiagnostics: vi.fn(),
  buildCrmWriteDraftWithDiagnostics: vi.fn(),
}));

vi.mock('src/utils/crm-query', () => ({
  answerCrmQuery: vi.fn(),
}));

vi.mock('src/utils/slack-thread-context-service', () => ({
  applyThreadContextPatchToSlackRequest,
}));

import {
  applyConfirmedSlackRequest,
  rejectSlackRequest,
} from 'src/utils/slack-orchestrator';

describe('slack orchestrator thread memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSlackRequestById.mockResolvedValue({
      id: 'request-1',
      name: 'APP_MENTION - test',
      slackTeamId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: 'thread-1',
      slackMessageTs: 'thread-1',
      slackUserId: 'U1',
      sourceType: 'APP_MENTION',
      slackResponseUrl: null,
      rawText: '@Daou-CRM-slack 미래금융 VDI 기회 단계 바꿔줘',
      normalizedText: '미래금융 VDI 기회 단계 바꿔줘',
      intentType: 'WRITE_DRAFT',
      processingStatus: 'CONFIRMED',
      confidence: null,
      draftJson: {
        summary: '영업기회 수정 초안',
        actions: [],
      },
      resultJson: null,
      errorMessage: null,
      dedupeKey: 'APP_MENTION:T1:C1:thread-1:event-1',
      approvedByWorkspaceMemberId: null,
      receivedAt: '2026-04-18T11:20:00.000Z',
      lastProcessedAt: '2026-04-18T11:20:30.000Z',
    });
    updateSlackRequest.mockResolvedValue({
      id: 'request-1',
      name: 'APP_MENTION - test',
      slackTeamId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: 'thread-1',
      slackMessageTs: 'thread-1',
      slackUserId: 'U1',
      sourceType: 'APP_MENTION',
      slackResponseUrl: null,
      rawText: '@Daou-CRM-slack 미래금융 VDI 기회 단계 바꿔줘',
      normalizedText: '미래금융 VDI 기회 단계 바꿔줘',
      intentType: 'WRITE_DRAFT',
      processingStatus: 'APPLIED',
      confidence: null,
      draftJson: {
        summary: '영업기회 수정 초안',
        actions: [],
      },
      resultJson: {
        ok: true,
      },
      errorMessage: null,
      dedupeKey: 'APP_MENTION:T1:C1:thread-1:event-1',
      approvedByWorkspaceMemberId: null,
      receivedAt: '2026-04-18T11:20:00.000Z',
      lastProcessedAt: '2026-04-18T11:21:00.000Z',
    });
    applyApprovedDraft.mockResolvedValue({
      created: [{ kind: 'company', id: 'company-1' }],
      updated: [{ kind: 'opportunity', id: 'opportunity-1' }],
      deleted: [],
      skipped: [],
      errors: [],
    });
    buildApplyResultJson.mockReturnValue({
      ok: true,
    });
    summarizeApplyResult.mockReturnValue('1건 생성, 1건 수정');
    postSlackReplyForRequest.mockResolvedValue(undefined);
    applyThreadContextPatchToSlackRequest.mockResolvedValue(undefined);
  });

  it('clears active pending approval after an applied draft', async () => {
    await applyConfirmedSlackRequest('request-1');

    expect(applyThreadContextPatchToSlackRequest).toHaveBeenCalledWith({
      slackRequest: expect.objectContaining({
        id: 'request-1',
        processingStatus: 'APPLIED',
      }),
      patch: {
        assistantTurn: {
          text: 'CRM 반영을 마쳤습니다. 1건 생성, 1건 수정',
          outcome: 'applied',
        },
        summary: 'CRM 반영을 마쳤습니다. 1건 생성, 1건 수정',
        selectedEntities: {
          companyIds: ['company-1'],
          opportunityIds: ['opportunity-1'],
        },
        lastQuerySnapshot: null,
        pendingApproval: null,
      },
    });
  });

  it('clears active pending approval after a rejection reply', async () => {
    updateSlackRequest.mockResolvedValueOnce({
      id: 'request-1',
      name: 'APP_MENTION - test',
      slackTeamId: 'T1',
      slackChannelId: 'C1',
      slackThreadTs: 'thread-1',
      slackMessageTs: 'thread-1',
      slackUserId: 'U1',
      sourceType: 'APP_MENTION',
      slackResponseUrl: null,
      rawText: '@Daou-CRM-slack 미래금융 VDI 기회 단계 바꿔줘',
      normalizedText: '미래금융 VDI 기회 단계 바꿔줘',
      intentType: 'WRITE_DRAFT',
      processingStatus: 'REJECTED',
      confidence: null,
      draftJson: {
        summary: '영업기회 수정 초안',
        actions: [],
      },
      resultJson: null,
      errorMessage: 'Slack에서 취소됨',
      dedupeKey: 'APP_MENTION:T1:C1:thread-1:event-1',
      approvedByWorkspaceMemberId: null,
      receivedAt: '2026-04-18T11:20:00.000Z',
      lastProcessedAt: '2026-04-18T11:21:30.000Z',
    });

    await rejectSlackRequest({
      slackRequestId: 'request-1',
    });

    expect(applyThreadContextPatchToSlackRequest).toHaveBeenCalledWith({
      slackRequest: expect.objectContaining({
        id: 'request-1',
        processingStatus: 'REJECTED',
      }),
      patch: {
        assistantTurn: {
          text: 'CRM 반영 요청을 취소했습니다.',
          outcome: 'rejected',
        },
        summary: 'CRM 반영 요청을 취소했습니다.',
        selectedEntities: {},
        lastQuerySnapshot: null,
        pendingApproval: null,
      },
    });
  });
});
