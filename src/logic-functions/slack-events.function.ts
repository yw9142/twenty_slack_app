import { defineLogicFunction, type RoutePayload } from 'twenty-sdk';

import { ROUTE_EVENT_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { handleSlackEventsRoute } from 'src/utils/slack-route-handler';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSlackEventsRoute(event);

export default defineLogicFunction({
  universalIdentifier: ROUTE_EVENT_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'slack-events-route',
  description: 'Receives Slack Events API requests under /s/slack/events',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/slack/events',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: [
      'x-slack-signature',
      'x-slack-request-timestamp',
      'content-type',
    ],
  },
});
