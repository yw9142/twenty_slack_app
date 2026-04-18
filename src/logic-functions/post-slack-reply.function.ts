import type { RoutePayload } from 'twenty-sdk';

import { POST_SLACK_REPLY_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handlePostSlackReplyRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handlePostSlackReplyRoute(event);

export default defineLogicFunction({
  universalIdentifier: POST_SLACK_REPLY_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'post-slack-reply',
  description: 'Posts a Slack reply for a stored Slack 요청',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/post-slack-reply',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
