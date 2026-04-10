import { defineLogicFunction, type RoutePayload } from 'twenty-sdk';

import { ROUTE_INTERACTIVITY_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { handleSlackInteractivityRoute } from 'src/utils/slack-route-handler';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSlackInteractivityRoute(event);

export default defineLogicFunction({
  universalIdentifier: ROUTE_INTERACTIVITY_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'slack-interactivity-route',
  description:
    'Receives Slack approval button payloads under /s/slack/interactivity',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/slack/interactivity',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: [
      'x-slack-signature',
      'x-slack-request-timestamp',
      'content-type',
    ],
  },
});
