import { describe, expect, it, vi } from 'vitest';

import { processSlackRequestWithCodex } from '../../slack-proxy/runner.mjs';

describe('codex runner failure modes', () => {
  it('fails when Codex exceeds the maximum number of tool steps', async () => {
    const toolClient = {
      callTool: vi.fn(async (endpoint: string) => {
        if (endpoint === 'load-slack-request') {
          return {
            id: 'request-1',
            normalizedText: 'Daou Data 현황 알려줘',
          };
        }

        if (endpoint === 'search-companies') {
          return {
            ok: true,
            results: [{ id: 'company-1', name: 'Daou Data' }],
          };
        }

        throw new Error(`Unexpected tool call: ${endpoint}`);
      }),
    };

    await expect(
      processSlackRequestWithCodex({
        slackRequestId: 'request-1',
        toolClient,
        maxSteps: 1,
        runCodexDecision: vi.fn().mockResolvedValue({
          kind: 'tool_call',
          endpoint: 'search-companies',
          payload: { query: 'Daou' },
        }),
      }),
    ).rejects.toThrow('Codex decision loop exceeded the maximum number of steps');
  });

  it('fails when Codex returns an unsupported final mode', async () => {
    const toolClient = {
      callTool: vi.fn(async (endpoint: string) => {
        if (endpoint === 'load-slack-request') {
          return {
            id: 'request-2',
            normalizedText: '미래금융 기회 추가',
          };
        }

        throw new Error(`Unexpected tool call: ${endpoint}`);
      }),
    };

    await expect(
      processSlackRequestWithCodex({
        slackRequestId: 'request-2',
        toolClient,
        runCodexDecision: vi.fn().mockResolvedValue({
          kind: 'final',
          mode: 'apply',
          message: 'invalid mode',
        }),
      }),
    ).rejects.toThrow('Unsupported Codex final mode: apply');
  });

  it('records runner errors when Codex returns an explicit error decision', async () => {
    const toolCalls: Array<[string, Record<string, unknown>]> = [];

    const result = await processSlackRequestWithCodex({
      slackRequestId: 'request-3',
      toolClient: {
        callTool: async (endpoint, payload) => {
          toolCalls.push([endpoint, payload]);

          if (endpoint === 'load-slack-request') {
            return {
              id: 'request-3',
              normalizedText: '정보가 부족한 요청',
            };
          }

          if (endpoint === 'mark-runner-error') {
            return {
              ok: true,
              processingStatus: 'ERROR',
            };
          }

          throw new Error(`Unexpected tool call: ${endpoint}`);
        },
      },
      runCodexDecision: vi.fn().mockResolvedValue({
        kind: 'error',
        message: 'insufficient context',
        diagnostics: {
          reason: 'missing_entities',
        },
      }),
    });

    expect(toolCalls).toEqual([
      ['load-slack-request', { slackRequestId: 'request-3' }],
      [
        'mark-runner-error',
        {
          slackRequestId: 'request-3',
          errorMessage: 'insufficient context',
          resultJson: {
            aiDiagnostics: {
              provider: 'codex',
              operation: 'runner_decision',
              attempted: true,
              succeeded: false,
              reason: 'missing_entities',
            },
          },
        },
      ],
    ]);
    expect(result).toEqual({
      kind: 'error',
      slackRequestId: 'request-3',
      message: 'insufficient context',
    });
  });
});
