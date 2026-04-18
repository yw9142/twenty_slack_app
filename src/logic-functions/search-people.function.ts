import type { RoutePayload } from 'twenty-sdk';

import { SEARCH_PEOPLE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleSearchPeopleRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSearchPeopleRoute(event);

export default defineLogicFunction({
  universalIdentifier: SEARCH_PEOPLE_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'search-people',
  description: 'Searches people for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/search-people',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
