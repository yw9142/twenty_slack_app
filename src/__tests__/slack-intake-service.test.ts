import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutation, query } = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock('src/utils/core-client', () => ({
  createCoreClient: () => ({
    query,
    mutation,
  }),
}));

import {
  buildSlackRequestLookupSelection,
  findSlackRequestById,
  updateSlackRequest,
} from 'src/utils/slack-intake-service';

describe('slack intake service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutation.mockResolvedValue({
      updateSlackRequest: {
        id: 'request-1',
        processingStatus: 'AWAITING_CONFIRMATION',
        draftJson: {
          summary: 'draft',
          actions: [],
        },
      },
    });
  });

  it('builds custom object lookup queries without paging arguments', () => {
    const selection = buildSlackRequestLookupSelection({
      dedupeKey: 'APP_MENTION:event-1',
    });

    expect(selection).toEqual({
      slackRequests: {
        __args: {
          filter: {
            dedupeKey: {
              eq: 'APP_MENTION:event-1',
            },
          },
        },
        edges: {
          node: expect.any(Object),
        },
      },
    });
  });

  it('preserves RAW_JSON draft fields returned as objects', async () => {
    query.mockResolvedValue({
      slackRequests: {
        edges: [
          {
            node: {
              id: 'request-1',
              processingStatus: 'AWAITING_CONFIRMATION',
              draftJson: {
                summary: 'draft',
                actions: [],
              },
              resultJson: {
                classification: {
                  intentType: 'WRITE_DRAFT',
                },
              },
            },
          },
        ],
      },
    });

    const record = await findSlackRequestById('request-1');

    expect(record?.draftJson).toEqual({
      summary: 'draft',
      actions: [],
    });
    expect(record?.resultJson).toEqual({
      classification: {
        intentType: 'WRITE_DRAFT',
      },
    });
  });

  it('sends RAW_JSON draft fields as objects in mutations', async () => {
    await updateSlackRequest({
      id: 'request-1',
      data: {
        draftJson: {
          summary: 'draft',
          actions: [],
        },
      },
    });

    expect(mutation).toHaveBeenCalledWith({
      updateSlackRequest: {
        __args: {
          id: 'request-1',
          data: expect.objectContaining({
            draftJson: {
              summary: 'draft',
              actions: [],
            },
          }),
        },
        approvedByWorkspaceMemberId: true,
        confidence: true,
        dedupeKey: true,
        draftJson: true,
        errorMessage: true,
        id: true,
        intentType: true,
        lastProcessedAt: true,
        name: true,
        normalizedText: true,
        processingStatus: true,
        rawText: true,
        receivedAt: true,
        resultJson: true,
        slackChannelId: true,
        slackMessageTs: true,
        slackResponseUrl: true,
        slackTeamId: true,
        slackThreadTs: true,
        slackUserId: true,
        sourceType: true,
      },
    });
  });
});
