import { DAILY_OPPORTUNITY_HEALTH_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { runOpportunityHealthCheck } from 'src/utils/crm-automations';
import { defineLogicFunction } from 'src/utils/define-logic-function';

const handler = async (): Promise<Record<string, unknown>> =>
  runOpportunityHealthCheck();

export default defineLogicFunction({
  universalIdentifier: DAILY_OPPORTUNITY_HEALTH_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'daily-opportunity-health',
  description: 'Runs a daily opportunity health audit and creates follow-up tasks',
  timeoutSeconds: 30,
  handler,
  cronTriggerSettings: {
    pattern: '0 0 * * *',
  },
});
