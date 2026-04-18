import type { RoutePayload } from 'twenty-sdk';

import { SEARCH_ACTIVITIES_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleSearchActivitiesRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSearchActivitiesRoute(event);

export default defineLogicFunction({
  universalIdentifier: SEARCH_ACTIVITIES_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'search-activities',
  description: 'Searches notes and tasks for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/search-activities',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
