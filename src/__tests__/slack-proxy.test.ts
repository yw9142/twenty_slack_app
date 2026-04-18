import { describe, expect, it, vi } from 'vitest';

import {
  getForwardHeaders,
  normalizeSlackStatus,
  resolveUpstreamUrl,
} from '../../slack-proxy/lib.mjs';
import {
  createTwentyToolClient,
  processSlackRequestWithCodex,
} from '../../slack-proxy/runner.mjs';
import {
  verifyRunnerSharedSecret,
  handleInternalRunnerRequest,
} from '../../slack-proxy/server-logic.mjs';

describe('slack proxy helpers', () => {
  it('maps public Slack routes to Twenty internal routes', () => {
    expect(
      resolveUpstreamUrl({
        baseUrl: 'http://server:3000',
        pathname: '/slack/events',
      }),
    ).toBe('http://server:3000/s/slack/events');

    expect(
      resolveUpstreamUrl({
        baseUrl: 'http://server:3000/',
        pathname: '/slack/commands',
      }),
    ).toBe('http://server:3000/s/slack/commands');
  });

  it('returns null for unsupported routes', () => {
    expect(
      resolveUpstreamUrl({
        baseUrl: 'http://server:3000',
        pathname: '/healthz',
      }),
    ).toBeNull();
  });

  it('normalizes successful upstream responses to 200', () => {
    expect(normalizeSlackStatus(200)).toBe(200);
    expect(normalizeSlackStatus(201)).toBe(200);
    expect(normalizeSlackStatus(204)).toBe(200);
    expect(normalizeSlackStatus(500)).toBe(500);
  });

  it('forwards only the headers the Twenty Slack routes need', () => {
    expect(
      getForwardHeaders({
        'content-type': 'application/json',
        'x-slack-signature': 'v0=abc',
        'x-slack-request-timestamp': '123',
        'user-agent': 'Slackbot',
      }),
    ).toEqual({
      'content-type': 'application/json',
      'x-slack-signature': 'v0=abc',
      'x-slack-request-timestamp': '123',
    });
  });
});

describe('slack proxy runner', () => {
  it('verifies the runner shared secret with a constant-time check', () => {
    expect(
      verifyRunnerSharedSecret({
        expectedSecret: 'runner-secret',
        providedSecret: undefined,
      }),
    ).toBe(false);

    expect(
      verifyRunnerSharedSecret({
        expectedSecret: 'runner-secret',
        providedSecret: 'runner-secret',
      }),
    ).toBe(true);
  });

  it('returns before the Codex job finishes processing', async () => {
    let resolveJob: ((value: unknown) => void) | undefined;
    const runCodexJob = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveJob = resolve;
        }),
    );

    const responsePromise = handleInternalRunnerRequest({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-shared-secret': 'runner-secret',
      },
      body: JSON.stringify({ slackRequestId: 'request-1' }),
      runnerSharedSecret: 'runner-secret',
      toolSharedSecret: 'tool-secret',
      twentyInternalUrl: 'http://server:3000',
      createToolClient: () => ({
        callTool: vi.fn(async () => ({ ok: true })),
      }),
      runCodexJob,
    });

    let settled = false;

    responsePromise.then(() => {
      settled = true;
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).toBe(true);
    expect(runCodexJob).toHaveBeenCalledTimes(1);
    await expect(responsePromise).resolves.toEqual({
      statusCode: 202,
      body: {
        ok: true,
        message: 'Runner accepted Slack request',
      },
    });

    resolveJob?.(undefined);
  });

  it('runs a tool-first Codex loop and persists the final query answer', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'tool_call',
        endpoint: 'search-companies',
        payload: { query: 'Daou' },
      })
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'query',
        message: 'Daou Data는 CRM/데이터 가상화 사업을 진행 중입니다.',
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-1',
      toolClient: {
        callTool: async (endpoint, payload) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              id: 'request-1',
              normalizedText: 'Daou Data의 CRM 현황이 궁금합니다.',
            };
          }

          if (endpoint === 'search-companies') {
            return {
              items: [{ id: 'company-1', name: 'Daou Data' }],
            };
          }

          if (endpoint === 'save-query-answer') {
            return { id: 'request-1', processingStatus: 'ANSWERED' };
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
      ['load-slack-request', { slackRequestId: 'request-1' }],
      ['search-companies', { query: 'Daou' }],
      [
        'save-query-answer',
        {
          reply: {
            text: 'Daou Data는 CRM/데이터 가상화 사업을 진행 중입니다.',
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
        },
      ],
      [
        'post-slack-reply',
        {
          slackRequestId: 'request-1',
          text: 'Daou Data는 CRM/데이터 가상화 사업을 진행 중입니다.',
        },
      ],
    ]);

    expect(result).toEqual({
      kind: 'query',
      slackRequestId: 'request-1',
      answer: 'Daou Data는 CRM/데이터 가상화 사업을 진행 중입니다.',
    });
  });

  it('treats tool responses with ok false as failures', async () => {
    const toolClient = createTwentyToolClient({
      twentyInternalUrl: 'http://server:3000',
      toolSharedSecret: 'tool-secret',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            message: 'denied',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
    });

    await expect(
      toolClient.callTool('search-companies', { query: 'Daou' }),
    ).rejects.toThrow('denied');
  });

  it('rejects direct state-changing tool calls from the model', async () => {
    const toolClient = {
      callTool: vi.fn(async (endpoint: string) => {
        if (endpoint === 'load-slack-request') {
          return {
            id: 'request-3',
            normalizedText: '미래금융 VDI 기회 추가',
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

  it('stores write drafts without issuing a second slack post from the runner', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];
    const runCodexDecision = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'final',
        mode: 'write_draft',
        message: '회사와 기회 초안을 만들었습니다.',
        draft: {
          summary: '회사와 기회 초안',
          confidence: 0.92,
          sourceText: '미래금융 VDI 기회 추가',
          actions: [],
          warnings: [],
        },
      });

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-2',
      toolClient: {
        callTool: async (endpoint, payload) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              id: 'request-2',
              normalizedText: '미래금융 VDI 기회 추가',
            };
          }

          if (endpoint === 'save-write-draft') {
            return { id: 'request-2', processingStatus: 'AWAITING_CONFIRMATION' };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision,
    });

    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-2' }],
      [
        'save-write-draft',
        {
          slackRequestId: 'request-2',
          draft: {
            summary: '회사와 기회 초안',
            confidence: 0.92,
            sourceText: '미래금융 VDI 기회 추가',
            actions: [],
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
        },
      ],
    ]);
    expect(result).toEqual({
      kind: 'write_draft',
      slackRequestId: 'request-2',
      draft: {
        summary: '회사와 기회 초안',
        confidence: 0.92,
        sourceText: '미래금융 VDI 기회 추가',
        actions: [],
        warnings: [],
      },
    });
  });

  it('rejects internal runner requests without the shared secret', async () => {
    const response = await handleInternalRunnerRequest({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ slackRequestId: 'request-1' }),
      runnerSharedSecret: 'runner-secret',
      toolSharedSecret: 'tool-secret',
      runCodexJob: vi.fn(),
      twentyInternalUrl: 'http://server:3000',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({
      ok: false,
      message: 'Unauthorized runner request',
    });
  });

  it('records runner failures through mark-runner-error and returns a handled response', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];

    const response = await handleInternalRunnerRequest({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-shared-secret': 'runner-secret',
      },
      body: JSON.stringify({ slackRequestId: 'request-1' }),
      runnerSharedSecret: 'runner-secret',
      toolSharedSecret: 'tool-secret',
      twentyInternalUrl: 'http://server:3000',
      createToolClient: () => ({
        callTool: async (endpoint, payload) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'mark-runner-error') {
            return { ok: true };
          }

          return {
            ok: true,
          };
        },
      }),
      runCodexJob: vi.fn().mockRejectedValue(new Error('runner exploded')),
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(toolCalls).toEqual([
      [
        'mark-runner-error',
        {
          slackRequestId: 'request-1',
          errorMessage: 'runner exploded',
          resultJson: {
            aiDiagnostics: {
              attempted: true,
              operation: 'runner_execution',
              provider: 'codex',
              succeeded: false,
            },
          },
        },
      ],
    ]);
    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({
      ok: true,
      message: 'Runner accepted Slack request',
    });
  });
});
