import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSlackRequest } = vi.hoisted(() => ({
  updateSlackRequest: vi.fn(),
}));

vi.mock('src/utils/env', () => ({
  getRunnerBaseUrl: vi.fn(() => 'https://runner.internal'),
  getRunnerSharedSecret: vi.fn(() => 'runner-secret'),
}));

vi.mock('src/utils/slack-intake-service', () => ({
  updateSlackRequest,
}));

import {
  handoffSlackRequestToRunner,
  postSlackRequestToRunner,
} from 'src/utils/codex-runner';

describe('codex runner handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts asynchronous runner acknowledgements', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          ok: true,
          accepted: true,
          slackRequestId: 'request-1',
        }),
      ),
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postSlackRequestToRunner({
        slackRequestId: 'request-1',
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://runner.internal/internal/slack-requests/process',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-runner-shared-secret': 'runner-secret',
        }),
        body: JSON.stringify({
          slackRequestId: 'request-1',
        }),
      }),
    );
  });

  it('treats semantic runner failures as errors even when the HTTP status is 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            ok: false,
            message: 'runner exploded',
          }),
        ),
      }),
    );

    await expect(
      postSlackRequestToRunner({
        slackRequestId: 'request-2',
      }),
    ).rejects.toThrow('runner exploded');
  });

  it('marks the request as ERROR when the runner handoff fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: vi.fn().mockResolvedValue(''),
      }),
    );

    updateSlackRequest.mockResolvedValue({
      id: 'request-3',
      processingStatus: 'ERROR',
    });

    await expect(
      handoffSlackRequestToRunner({
        slackRequestId: 'request-3',
      }),
    ).resolves.toBe('ERROR');

    expect(updateSlackRequest).toHaveBeenCalledWith({
      id: 'request-3',
      data: expect.objectContaining({
        processingStatus: 'ERROR',
        errorMessage: expect.stringContaining('Runner rejected Slack request request-3'),
      }),
    });
  });
});
