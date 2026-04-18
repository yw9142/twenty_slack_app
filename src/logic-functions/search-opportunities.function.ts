import type { RoutePayload } from 'twenty-sdk';

import { SEARCH_OPPORTUNITIES_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleSearchOpportunitiesRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSearchOpportunitiesRoute(event);

export default defineLogicFunction({
  universalIdentifier: SEARCH_OPPORTUNITIES_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'search-opportunities',
  description: 'Searches opportunities for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/search-opportunities',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
