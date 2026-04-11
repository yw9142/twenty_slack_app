import { BUILD_DRAFT_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { buildCrmWriteDraft } from 'src/utils/intelligence';

const handler = async ({
  text,
}: {
  text: string;
}): Promise<Record<string, unknown>> => {
  const draft = await buildCrmWriteDraft(text);

  return {
    draft,
  };
};

export default defineLogicFunction({
  universalIdentifier: BUILD_DRAFT_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'build-crm-write-draft',
  description: 'Builds a structured CRM write draft from Slack free text',
  timeoutSeconds: 20,
  handler,
});
