import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRequiredEnv } = vi.hoisted(() => ({
  getRequiredEnv: vi.fn(() => 'xoxb-test-token'),
}));

vi.mock('src/utils/env', () => ({
  getRequiredEnv,
}));

import {
  postSlackChannelMessage,
  postSlackResponseUrl,
} from 'src/utils/slack-api';

describe('slack api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('throws when Slack chat.postMessage returns ok false', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          ok: false,
          error: 'channel_not_found',
        }),
      ),
    }) as typeof fetch;

    await expect(
      postSlackChannelMessage({
        channelId: 'C1',
        reply: {
          text: 'hello',
        },
      }),
    ).rejects.toThrow('channel_not_found');
  });

  it('accepts response_url replies when Slack returns ok text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('ok'),
    }) as typeof fetch;

    await expect(
      postSlackResponseUrl({
        responseUrl: 'https://hooks.slack.test/commands/1',
        reply: {
          text: 'done',
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('throws when response_url returns an error payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          ok: false,
          error: 'expired_url',
        }),
      ),
    }) as typeof fetch;

    await expect(
      postSlackResponseUrl({
        responseUrl: 'https://hooks.slack.test/commands/1',
        reply: {
          text: 'done',
        },
      }),
    ).rejects.toThrow('expired_url');
  });
});
