import { defineLogicFunction } from 'twenty-sdk';

import { POST_SLACK_MESSAGE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { findSlackRequestById } from 'src/utils/slack-intake-service';
import { postSlackReplyForRequest } from 'src/utils/slack-api';
import type { SlackBlock } from 'src/types/slack-agent';

const handler = async ({
  slackRequestId,
  text,
  blocks,
  replaceOriginal,
}: {
  slackRequestId: string;
  text: string;
  blocks?: SlackBlock[];
  replaceOriginal?: boolean;
}): Promise<Record<string, unknown>> => {
  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    throw new Error(`Slack 요청 ${slackRequestId}를 찾지 못했습니다.`);
  }

  await postSlackReplyForRequest({
    slackRequest,
    reply: {
      text,
      blocks,
    },
    replaceOriginal,
  });

  return {
    ok: true,
  };
};

export default defineLogicFunction({
  universalIdentifier: POST_SLACK_MESSAGE_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'post-slack-message',
  description: 'Posts a Slack reply for an existing Slack 요청 record',
  timeoutSeconds: 10,
  handler,
});
