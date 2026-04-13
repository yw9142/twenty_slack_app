import { POST_SLACK_CHANNEL_MESSAGE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import type { SlackBlock } from 'src/types/slack-agent';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { getManagementChannelId } from 'src/utils/env';
import { postSlackChannelMessage } from 'src/utils/slack-api';

const handler = async ({
  text,
  blocks,
  threadTs,
  channelId,
  useManagementChannel,
}: {
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string | null;
  channelId?: string | null;
  useManagementChannel?: boolean | null;
}): Promise<Record<string, unknown>> => {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('text is required to post a Slack channel message');
  }

  const normalizedChannelId =
    typeof channelId === 'string' ? channelId.trim() : '';
  const resolvedChannelId =
    normalizedChannelId.length > 0
      ? normalizedChannelId
      : useManagementChannel
        ? getManagementChannelId()
        : '';

  if (resolvedChannelId.length === 0) {
    throw new Error(
      'channelId is required unless useManagementChannel is enabled and MANAGEMENT_CHANNEL_ID is configured',
    );
  }

  const result = await postSlackChannelMessage({
    channelId: resolvedChannelId,
    threadTs,
    reply: {
      text: text.trim(),
      blocks,
    },
  });

  return {
    ok: true,
    channelId: result.channelId,
    threadTs: result.threadTs,
    messageTs: result.messageTs,
  };
};

export default defineLogicFunction({
  universalIdentifier: POST_SLACK_CHANNEL_MESSAGE_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'post-slack-channel-message',
  description:
    'Posts a Slack message to a target channel or the configured management channel',
  timeoutSeconds: 10,
  handler,
});
