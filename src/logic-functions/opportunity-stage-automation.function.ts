import {
  type DatabaseEventPayload,
  type ObjectRecordUpdateEvent,
  defineLogicFunction,
} from 'twenty-sdk';

import { OPPORTUNITY_STAGE_AUTOMATION_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { runOpportunityStageAutomation } from 'src/utils/crm-automations';

const handler = async (
  event: DatabaseEventPayload<ObjectRecordUpdateEvent<Record<string, unknown>>>,
): Promise<Record<string, unknown>> =>
  runOpportunityStageAutomation({
    opportunityId: event.recordId,
  });

export default defineLogicFunction({
  universalIdentifier:
    OPPORTUNITY_STAGE_AUTOMATION_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'opportunity-stage-automation',
  description:
    'Checks partner/vendor completeness when opportunity stage changes',
  timeoutSeconds: 20,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'opportunity.updated',
    updatedFields: ['stage'],
  },
});
