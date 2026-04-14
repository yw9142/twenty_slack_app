import { BUILD_DRAFT_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { buildCrmWriteDraftWithDiagnostics } from 'src/utils/intelligence';

const handler = async ({
  text,
}: {
  text: string;
}): Promise<Record<string, unknown>> => {
  const drafted = await buildCrmWriteDraftWithDiagnostics(text);

  return {
    draft: drafted.draft,
    aiDiagnostics: {
      writeDraft: drafted.aiDiagnostics,
    },
  };
};

export default defineLogicFunction({
  universalIdentifier: BUILD_DRAFT_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'build-crm-write-draft',
  description: 'Builds a structured CRM write draft from Slack free text',
  timeoutSeconds: 60,
  handler,
});
