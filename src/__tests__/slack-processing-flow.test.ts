import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createOrLoadSlackRequest,
  confirmSlackRequest,
  applyConfirmedSlackRequest,
  approveSlackRequest,
  rejectSlackRequest,
  verifySlackSignature,
  updateSlackRequest,
  handoffSlackRequestToRunner,
} = vi.hoisted(() => ({
  createOrLoadSlackRequest: vi.fn(),
  confirmSlackRequest: vi.fn(),
  applyConfirmedSlackRequest: vi.fn(),
  approveSlackRequest: vi.fn(),
  rejectSlackRequest: vi.fn(),
  verifySlackSignature: vi.fn(),
  updateSlackRequest: vi.fn(),
  handoffSlackRequestToRunner: vi.fn(),
}));

vi.mock('src/utils/env', () => ({
  getRequiredEnv: vi.fn(() => 'slack-signing-secret'),
  getOptionalEnv: vi.fn(() => undefined),
  getAllowedChannelIds: vi.fn(() => []),
}));

vi.mock('src/utils/slack-signature', () => ({
  verifySlackSignature,
}));

vi.mock('src/utils/slack-intake-service', () => ({
  createOrLoadSlackRequest,
  updateSlackRequest,
}));

vi.mock('src/utils/slack-orchestrator', () => ({
  confirmSlackRequest,
  applyConfirmedSlackRequest,
  approveSlackRequest,
  rejectSlackRequest,
}));

vi.mock('src/utils/codex-runner', () => ({
  handoffSlackRequestToRunner,
}));

import applyApprovedDraftFunction from 'src/logic-functions/apply-approved-draft.function';
import continueClassifiedSlackRequestFunction from 'src/logic-functions/continue-classified-slack-request.function';
import processSlackIntakeFunction from 'src/logic-functions/process-slack-intake.function';
import {
  handleSlackCommandsRoute,
  handleSlackInteractivityRoute,
} from 'src/utils/slack-route-handler';

describe('slack processing flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifySlackSignature.mockReturnValue(true);
    createOrLoadSlackRequest.mockResolvedValue({
      id: 'request-1',
      processingStatus: 'RECEIVED',
    });
    updateSlackRequest.mockResolvedValue({
      id: 'request-1',
      processingStatus: 'PROCESSING',
    });
    confirmSlackRequest.mockResolvedValue({
      id: 'request-1',
      processingStatus: 'CONFIRMED',
    });
    rejectSlackRequest.mockResolvedValue({
      id: 'request-1',
      processingStatus: 'REJECTED',
    });
    handoffSlackRequestToRunner.mockResolvedValue('PROCESSING');
    applyConfirmedSlackRequest.mockResolvedValue({
      id: 'request-1',
      processingStatus: 'APPLIED',
      resultJson: { ok: true },
    });
  });

  it('stores slash commands for async processing instead of running orchestration inline', async () => {
    const response = await handleSlackCommandsRoute({
      body: 'team_id=T1&channel_id=C1&user_id=U1&text=%EC%A7%88%EC%9D%98&command=%2Fcrm&trigger_id=trigger-1&response_url=https%3A%2F%2Fhooks.slack.test%2Fcommands%2F1',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-signature': 'v0=test',
        'x-slack-request-timestamp': '1710000000',
      },
    } as never);

    expect(response).toEqual({
      ok: true,
      text: '요청을 접수했습니다. 결과를 곧 스레드에 올릴게요.',
    });
    expect(createOrLoadSlackRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'SLASH_COMMAND',
        processingStatus: 'RECEIVED',
        dedupeKey: 'SLASH_COMMAND:T1:C1:trigger-1:/crm',
      }),
    );
  });

  it('confirms interactive approvals without applying CRM writes inline', async () => {
    const response = await handleSlackInteractivityRoute({
      body: {
        payload: JSON.stringify({
          type: 'block_actions',
          user: { id: 'U1' },
          actions: [
            {
              action_id: 'approve_slack_request',
              value: 'request-1',
            },
          ],
        }),
      },
      headers: {
        'content-type': 'application/json',
        'x-slack-signature': 'v0=test',
        'x-slack-request-timestamp': '1710000000',
      },
    } as never);

    expect(response).toEqual({
      ok: true,
      text: '승인 요청을 반영했습니다.',
    });
    expect(confirmSlackRequest).toHaveBeenCalledWith({
      slackRequestId: 'request-1',
      approvedBySlackUserId: 'U1',
    });
    expect(approveSlackRequest).not.toHaveBeenCalled();
  });

  it('processes newly created slack requests from the database trigger', async () => {
    const handler = processSlackIntakeFunction.config.handler as (
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    const result = await handler({
      recordId: 'request-1',
      properties: {
        after: {
          processingStatus: 'RECEIVED',
        },
      },
    });

    expect(processSlackIntakeFunction.config.databaseEventTriggerSettings).toEqual({
      eventName: 'slackRequest.created',
    });
    expect(updateSlackRequest).toHaveBeenCalledWith({
      id: 'request-1',
      data: expect.objectContaining({
        processingStatus: 'PROCESSING',
      }),
    });
    expect(handoffSlackRequestToRunner).toHaveBeenCalledWith({
      slackRequestId: 'request-1',
    });
    expect(result).toEqual({
      processingStatus: 'PROCESSING',
      slackRequestId: 'request-1',
    });
  });

  it('marks the request as ERROR when the runner handoff fails', async () => {
    handoffSlackRequestToRunner.mockResolvedValueOnce('ERROR');

    const handler = processSlackIntakeFunction.config.handler as (
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    const result = await handler({
      recordId: 'request-1',
    });

    expect(updateSlackRequest).toHaveBeenNthCalledWith(1, {
      id: 'request-1',
      data: expect.objectContaining({
        processingStatus: 'PROCESSING',
      }),
    });
    expect(updateSlackRequest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      processingStatus: 'ERROR',
      slackRequestId: 'request-1',
    });
  });

  it('continues classified requests from the updated-status trigger', async () => {
    const handler = continueClassifiedSlackRequestFunction.config.handler as (
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    const skippedResult = await handler({
      recordId: 'request-1',
      properties: {
        after: {
          processingStatus: 'ANSWERED',
        },
      },
    });

    expect(skippedResult).toEqual({
      processingStatus: 'ANSWERED',
      skipped: true,
      slackRequestId: 'request-1',
    });
    expect(handoffSlackRequestToRunner).not.toHaveBeenCalledWith({
      slackRequestId: 'request-1',
    });

    const continuedResult = await handler({
      recordId: 'request-1',
      properties: {
        after: {
          processingStatus: 'CLASSIFIED',
        },
      },
    });

    expect(
      continueClassifiedSlackRequestFunction.config.databaseEventTriggerSettings,
    ).toBeUndefined();
    expect(updateSlackRequest).toHaveBeenCalledWith({
      id: 'request-1',
      data: expect.objectContaining({
        processingStatus: 'PROCESSING',
      }),
    });
    expect(handoffSlackRequestToRunner).toHaveBeenCalledWith({
      slackRequestId: 'request-1',
    });
    expect(continuedResult).toEqual({
      processingStatus: 'PROCESSING',
      slackRequestId: 'request-1',
    });
  });

  it('applies confirmed drafts only when the status transition reaches CONFIRMED', async () => {
    const handler = applyApprovedDraftFunction.config.handler as (
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    const skippedResult = await handler({
      recordId: 'request-1',
      properties: {
        after: {
          processingStatus: 'ANSWERED',
        },
      },
    });

    expect(skippedResult).toEqual({
      processingStatus: 'ANSWERED',
      skipped: true,
      slackRequestId: 'request-1',
    });
    expect(applyConfirmedSlackRequest).not.toHaveBeenCalled();

    const appliedResult = await handler({
      recordId: 'request-1',
      properties: {
        after: {
          processingStatus: 'CONFIRMED',
        },
      },
    });

    expect(
      applyApprovedDraftFunction.config.databaseEventTriggerSettings,
    ).toEqual({
      eventName: 'slackRequest.updated',
      updatedFields: ['processingStatus'],
    });
    expect(applyConfirmedSlackRequest).toHaveBeenCalledWith('request-1');
    expect(appliedResult).toEqual({
      processingStatus: 'APPLIED',
      resultJson: { ok: true },
      slackRequestId: 'request-1',
    });
  });
});
