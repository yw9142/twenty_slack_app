import { defineLogicFunction, type RoutePayload } from 'twenty-sdk';

import { ROUTE_COMMAND_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { handleSlackCommandsRoute } from 'src/utils/slack-route-handler';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSlackCommandsRoute(event);

export default defineLogicFunction({
  universalIdentifier: ROUTE_COMMAND_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'slack-commands-route',
  description: 'Receives /crm slash command payloads under /s/slack/commands',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/slack/commands',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: [
      'x-slack-signature',
      'x-slack-request-timestamp',
      'content-type',
    ],
  },
});
