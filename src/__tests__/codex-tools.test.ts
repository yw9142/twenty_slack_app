import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchCompanies,
  fetchPeople,
  fetchOpportunities,
  fetchLicenses,
  fetchNotes,
  fetchTasks,
  findSlackRequestById,
  updateSlackRequest,
  postSlackReplyForRequest,
} = vi.hoisted(() => ({
  fetchCompanies: vi.fn(),
  fetchPeople: vi.fn(),
  fetchOpportunities: vi.fn(),
  fetchLicenses: vi.fn(),
  fetchNotes: vi.fn(),
  fetchTasks: vi.fn(),
  findSlackRequestById: vi.fn(),
  updateSlackRequest: vi.fn(),
  postSlackReplyForRequest: vi.fn(),
}));

vi.mock('src/utils/env', () => ({
  getRequiredEnv: vi.fn((key: string) => {
    if (key === 'TOOL_SHARED_SECRET') {
      return 'tool-secret';
    }

    return '';
  }),
  getOptionalEnv: vi.fn(() => undefined),
  getAllowedChannelIds: vi.fn(() => []),
  getToolSharedSecret: vi.fn(() => 'tool-secret'),
}));

vi.mock('src/utils/crm-query', () => ({
  fetchCompanies,
  fetchPeople,
  fetchOpportunities,
  fetchLicenses,
  fetchNotes,
  fetchTasks,
}));

vi.mock('src/utils/slack-intake-service', () => ({
  findSlackRequestById,
  updateSlackRequest,
}));

vi.mock('src/utils/slack-api', () => ({
  postSlackReplyForRequest,
}));

import {
  handleLoadSlackRequestRoute,
  handleMarkRunnerErrorRoute,
  handlePostSlackReplyRoute,
  handleSaveQueryAnswerRoute,
  handleSaveWriteDraftRoute,
  handleSearchCompaniesRoute,
} from 'src/utils/codex-tools';

describe('codex tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findSlackRequestById.mockResolvedValue({
      id: 'request-1',
      name: 'APP_MENTION - test',
      processingStatus: 'RECEIVED',
      draftJson: null,
      resultJson: null,
    });
    updateSlackRequest.mockResolvedValue({
      id: 'request-1',
      processingStatus: 'ANSWERED',
      resultJson: { ok: true },
    });
    postSlackReplyForRequest.mockResolvedValue(undefined);
    fetchCompanies.mockResolvedValue([
      { id: 'company-1', name: 'A은행' },
      { id: 'company-2', name: '미래금융' },
    ]);
    fetchPeople.mockResolvedValue([]);
    fetchOpportunities.mockResolvedValue([]);
    fetchLicenses.mockResolvedValue([]);
    fetchNotes.mockResolvedValue([]);
    fetchTasks.mockResolvedValue([]);
  });

  it('rejects tool requests without the shared secret', async () => {
    const result = await handleLoadSlackRequestRoute({
      body: {
        slackRequestId: 'request-1',
      },
      headers: {
        'content-type': 'application/json',
      },
    } as never);

    expect(result).toEqual({
      ok: false,
      message: 'Invalid tool shared secret',
    });
  });

  it('loads slack requests when the shared secret is present', async () => {
    const result = await handleLoadSlackRequestRoute({
      body: {
        slackRequestId: 'request-1',
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(result).toEqual({
      ok: true,
      slackRequest: expect.objectContaining({
        id: 'request-1',
        processingStatus: 'RECEIVED',
      }),
    });
  });

  it('stores query answers with provider-neutral diagnostics', async () => {
    const result = await handleSaveQueryAnswerRoute({
      body: {
        slackRequestId: 'request-1',
        reply: {
          text: '응답입니다.',
        },
        resultJson: {
          queryCount: 1,
          runnerDiagnostics: {
            operation: 'query_answer',
            attempted: true,
            succeeded: true,
          },
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(updateSlackRequest).toHaveBeenCalledWith({
      id: 'request-1',
      data: expect.objectContaining({
        processingStatus: 'ANSWERED',
        resultJson: expect.objectContaining({
          queryCount: 1,
          aiDiagnostics: expect.objectContaining({
            operation: 'query_answer',
          }),
        }),
      }),
    });
    expect(result).toEqual({
      ok: true,
      processingStatus: 'ANSWERED',
      slackRequestId: 'request-1',
    });
  });

  it('filters company search results by text', async () => {
    const result = await handleSearchCompaniesRoute({
      body: {
        query: '미래',
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(result.ok).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({
        id: 'company-2',
        name: '미래금융',
      }),
    ]);
  });

  it('posts slack replies for request ids', async () => {
    const result = await handlePostSlackReplyRoute({
      body: {
        slackRequestId: 'request-1',
        reply: {
          text: '완료',
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(postSlackReplyForRequest).toHaveBeenCalledWith({
      slackRequest: expect.objectContaining({
        id: 'request-1',
        processingStatus: 'RECEIVED',
      }),
      reply: {
        text: '완료',
      },
      replaceOriginal: false,
    });
    expect(result).toEqual({
      ok: true,
      slackRequestId: 'request-1',
    });
  });

  it('stores write drafts before approval', async () => {
    updateSlackRequest.mockResolvedValueOnce({
      id: 'request-1',
      processingStatus: 'AWAITING_CONFIRMATION',
    });

    const result = await handleSaveWriteDraftRoute({
      body: {
        slackRequestId: 'request-1',
        draft: {
          summary: '초안',
          confidence: 0.9,
          sourceText: '테스트',
          actions: [],
          warnings: [],
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(updateSlackRequest).toHaveBeenCalledWith({
      id: 'request-1',
      data: expect.objectContaining({
        processingStatus: 'AWAITING_CONFIRMATION',
        draftJson: expect.objectContaining({
          summary: '초안',
        }),
      }),
    });
    expect(postSlackReplyForRequest).toHaveBeenCalledWith({
      slackRequest: expect.objectContaining({
        id: 'request-1',
      }),
      reply: expect.objectContaining({
        text: expect.stringContaining('CRM 반영 초안을 만들었습니다.'),
      }),
    });
    expect(result).toEqual({
      ok: true,
      processingStatus: 'AWAITING_CONFIRMATION',
      slackRequestId: 'request-1',
    });
  });

  it('stores runner failures using the canonical errorMessage field', async () => {
    updateSlackRequest.mockResolvedValueOnce({
      id: 'request-1',
      processingStatus: 'ERROR',
    });

    const result = await handleMarkRunnerErrorRoute({
      body: {
        slackRequestId: 'request-1',
        errorMessage: 'runner failed',
        resultJson: {
          aiDiagnostics: {
            operation: 'runner',
            attempted: true,
            succeeded: false,
            provider: 'codex',
          },
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(updateSlackRequest).toHaveBeenCalledWith({
      id: 'request-1',
      data: expect.objectContaining({
        processingStatus: 'ERROR',
        errorMessage: 'runner failed',
        resultJson: expect.objectContaining({
          aiDiagnostics: expect.objectContaining({
            operation: 'runner',
            succeeded: false,
          }),
        }),
      }),
    });
    expect(result).toEqual({
      ok: true,
      processingStatus: 'ERROR',
      slackRequestId: 'request-1',
    });
  });
});
