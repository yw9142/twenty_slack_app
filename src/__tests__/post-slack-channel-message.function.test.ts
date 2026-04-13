import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getManagementChannelId, postSlackChannelMessage } = vi.hoisted(() => ({
  getManagementChannelId: vi.fn(() => ''),
  postSlackChannelMessage: vi.fn(),
}));

vi.mock('src/utils/env', () => ({
  getManagementChannelId,
}));

vi.mock('src/utils/slack-api', () => ({
  postSlackChannelMessage,
}));

import postSlackChannelMessageFunction from 'src/logic-functions/post-slack-channel-message.function';

describe('post-slack-channel-message function', () => {
  const handler = postSlackChannelMessageFunction.config.handler as (
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    getManagementChannelId.mockReturnValue('');
    postSlackChannelMessage.mockResolvedValue({
      channelId: 'C1',
      threadTs: null,
      messageTs: '1710000000.000100',
    });
  });

  it('rejects blank text before calling Slack', async () => {
    await expect(
      handler({
        text: '   ',
        channelId: 'C1',
      }),
    ).rejects.toThrow('text is required');

    expect(postSlackChannelMessage).not.toHaveBeenCalled();
  });

  it('requires a resolved channel id', async () => {
    await expect(
      handler({
        text: 'hello',
        useManagementChannel: false,
      }),
    ).rejects.toThrow('channelId is required');

    expect(postSlackChannelMessage).not.toHaveBeenCalled();
  });

  it('posts to the management channel when requested', async () => {
    getManagementChannelId.mockReturnValue('CMGMT');

    await expect(
      handler({
        text: 'hello',
        useManagementChannel: true,
      }),
    ).resolves.toEqual({
      ok: true,
      channelId: 'C1',
      threadTs: null,
      messageTs: '1710000000.000100',
    });

    expect(postSlackChannelMessage).toHaveBeenCalledWith({
      channelId: 'CMGMT',
      threadTs: undefined,
      reply: {
        text: 'hello',
        blocks: undefined,
      },
    });
  });
});
