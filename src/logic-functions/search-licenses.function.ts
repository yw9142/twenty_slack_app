import type { RoutePayload } from 'twenty-sdk';

import { SEARCH_LICENSES_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleSearchLicensesRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSearchLicensesRoute(event);

export default defineLogicFunction({
  universalIdentifier: SEARCH_LICENSES_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'search-licenses',
  description: 'Searches licenses for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/search-licenses',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
