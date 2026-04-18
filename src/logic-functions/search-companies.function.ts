import type { RoutePayload } from 'twenty-sdk';

import { SEARCH_COMPANIES_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleSearchCompaniesRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSearchCompaniesRoute(event);

export default defineLogicFunction({
  universalIdentifier: SEARCH_COMPANIES_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'search-companies',
  description: 'Searches companies for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/search-companies',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
