import {
  SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  SLACK_WRITE_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { ViewType, defineView } from 'src/utils/twenty-shim';
import { createSlackRequestBaseViewFields } from 'src/views/slack-request-view-fields';

export default defineView({
  universalIdentifier: SLACK_WRITE_VIEW_UNIVERSAL_IDENTIFIER,
  name: '쓰기 초안 이력',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  type: ViewType.TABLE,
  icon: 'IconPencil',
  position: 4,
  fields: createSlackRequestBaseViewFields({
    name: '73fc2f5c-4d9d-47ae-a845-cec6a142f4b6',
    processingStatus: '6548bef5-ba9b-46f8-b733-8f26dd5de8a8',
    intentType: 'baf13414-4a82-46df-a8f3-c19f71847340',
    sourceType: '3bf9cf28-085e-48ba-b013-9f59ab8107cb',
    slackChannelId: 'ee7a7606-4402-420f-a6ec-5a0a26a11271',
    confidence: '802a1dfc-dab9-498e-8f2f-c6e06c60d19b',
    receivedAt: 'e116c0e8-f88e-449e-841d-10176c0d0836',
    lastProcessedAt: '461a33cb-d0f4-4587-8633-700a14c4f5f6',
  }),
  filters: [
    {
      universalIdentifier: '3649d57e-8cea-449b-9e48-9694463f2a3a',
      fieldMetadataUniversalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.intentType,
      operand: 'IS',
      value: 'WRITE_DRAFT',
    },
  ],
});
