import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchCompanies,
  fetchPeople,
  fetchOpportunities,
  fetchLicenses,
  fetchNotes,
  fetchTasks,
  executeImmediateCreateAction,
  findSlackRequestById,
  updateSlackRequest,
  postSlackReplyForRequest,
  previewApprovalAction,
} = vi.hoisted(() => ({
  fetchCompanies: vi.fn(),
  fetchPeople: vi.fn(),
  fetchOpportunities: vi.fn(),
  fetchLicenses: vi.fn(),
  fetchNotes: vi.fn(),
  fetchTasks: vi.fn(),
  executeImmediateCreateAction: vi.fn(),
  findSlackRequestById: vi.fn(),
  updateSlackRequest: vi.fn(),
  postSlackReplyForRequest: vi.fn(),
  previewApprovalAction: vi.fn(),
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

vi.mock('src/utils/crm-write', () => ({
  executeImmediateCreateAction,
  previewApprovalAction,
}));

vi.mock('src/utils/slack-intake-service', () => ({
  findSlackRequestById,
  updateSlackRequest,
}));

vi.mock('src/utils/slack-api', () => ({
  postSlackReplyForRequest,
}));

import {
  handleCreateRecordRoute,
  handleDeleteRecordRoute,
  handleGetToolCatalogRoute,
  handleLoadSlackRequestRoute,
  handleMarkRunnerErrorRoute,
  handlePostSlackReplyRoute,
  handleSaveAppliedResultRoute,
  handleSaveQueryAnswerRoute,
  handleSaveWriteDraftRoute,
  handleSearchCompaniesRoute,
  handleUpdateRecordRoute,
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
    executeImmediateCreateAction.mockResolvedValue({
      kind: 'company',
      operation: 'create',
      id: 'company-1',
    });
    previewApprovalAction.mockResolvedValue({
      action: {
        kind: 'company',
        operation: 'update',
        targetId: 'company-1',
        lookup: {
          id: 'company-1',
          name: '미래금융',
        },
        data: {
          companyStatus: 'CUSTOMER',
        },
      },
      matchedRecord: {
        id: 'company-1',
        label: '미래금융',
      },
      reviewItem: {
        kind: 'company',
        decision: 'UPDATE',
        target: '미래금융',
        matchedRecord: '미래금융',
        reason: null,
        fields: [
          {
            key: 'companyStatus',
            value: 'CUSTOMER',
          },
        ],
      },
    });
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

  it('returns the shared tool catalog for the runner', async () => {
    const result = await handleGetToolCatalogRoute({
      body: null,
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    const toolCatalog = result.toolCatalog as {
      modelVisibleTools: Array<{
        name: string;
        policy?: string;
        inputSchema?: Record<string, unknown>;
      }>;
      internalTools: Array<{ name: string }>;
    };

    expect(result.ok).toBe(true);
    expect(toolCatalog.modelVisibleTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'create-record' }),
        expect.objectContaining({ name: 'update-record' }),
        expect.objectContaining({ name: 'delete-record' }),
      ]),
    );
    expect(toolCatalog.internalTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'get-tool-catalog' }),
        expect.objectContaining({ name: 'save-applied-result' }),
      ]),
    );
    expect(
      toolCatalog.modelVisibleTools.find(
        (tool) => tool.name === 'search-opportunities',
      ),
    ).toEqual(
      expect.objectContaining({
        policy: expect.stringContaining('"query": ""'),
      }),
    );
    expect(
      toolCatalog.modelVisibleTools.find((tool) => tool.name === 'delete-record'),
    ).toEqual(
      expect.objectContaining({
        inputSchema: expect.objectContaining({
          required: ['kind'],
        }),
      }),
    );
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

  it('executes immediate create tools through the CRM write helper', async () => {
    const result = await handleCreateRecordRoute({
      body: {
        kind: 'company',
        data: {
          name: '미래금융',
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(executeImmediateCreateAction).toHaveBeenCalledWith({
      kind: 'company',
      operation: 'create',
      data: {
        name: '미래금융',
      },
    });
    expect(result).toEqual({
      ok: true,
      actionResult: {
        id: 'company-1',
        kind: 'company',
        operation: 'create',
      },
    });
  });

  it('plans update actions instead of mutating immediately', async () => {
    const result = await handleUpdateRecordRoute({
      body: {
        kind: 'company',
        targetId: 'company-1',
        data: {
          companyStatus: 'CUSTOMER',
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(previewApprovalAction).toHaveBeenCalledWith({
      kind: 'company',
      operation: 'update',
      targetId: 'company-1',
      data: {
        companyStatus: 'CUSTOMER',
      },
    });
    expect(result).toEqual({
      ok: true,
      plannedAction: expect.objectContaining({
        operation: 'update',
      }),
      matchedRecord: expect.objectContaining({
        id: 'company-1',
      }),
      reviewItem: expect.objectContaining({
        decision: 'UPDATE',
      }),
    });
  });

  it('plans delete actions instead of mutating immediately', async () => {
    previewApprovalAction.mockResolvedValueOnce({
      action: {
        kind: 'company',
        operation: 'delete',
        targetId: 'company-1',
        data: {},
      },
      matchedRecord: {
        id: 'company-1',
        label: '미래금융',
      },
      reviewItem: {
        kind: 'company',
        decision: 'DELETE',
        target: '미래금융',
        matchedRecord: '미래금융',
        reason: '승인 후 실제 삭제가 실행됩니다.',
        fields: [],
      },
    });

    const result = await handleDeleteRecordRoute({
      body: {
        kind: 'company',
        targetId: 'company-1',
        data: {},
      },
      headers: {
        'content-type': 'application/json',
        'x-tool-shared-secret': 'tool-secret',
      },
    } as never);

    expect(previewApprovalAction).toHaveBeenCalledWith({
      kind: 'company',
      operation: 'delete',
      targetId: 'company-1',
      data: {},
    });
    expect(result).toEqual({
      ok: true,
      plannedAction: expect.objectContaining({
        operation: 'delete',
      }),
      matchedRecord: expect.objectContaining({
        id: 'company-1',
      }),
      reviewItem: expect.objectContaining({
        decision: 'DELETE',
      }),
    });
  });

  it('stores applied results for immediate create flows', async () => {
    updateSlackRequest.mockResolvedValueOnce({
      id: 'request-1',
      processingStatus: 'APPLIED',
    });

    const result = await handleSaveAppliedResultRoute({
      body: {
        slackRequestId: 'request-1',
        reply: {
          text: '미래금융 회사를 생성했습니다.',
        },
        resultJson: {
          executedTools: [{ toolName: 'create-record' }],
          aiDiagnostics: {
            operation: 'applied',
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
        processingStatus: 'APPLIED',
        resultJson: expect.objectContaining({
          executedTools: [{ toolName: 'create-record' }],
          reply: expect.objectContaining({
            text: '미래금융 회사를 생성했습니다.',
          }),
        }),
      }),
    });
    expect(result).toEqual({
      ok: true,
      processingStatus: 'APPLIED',
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
});
