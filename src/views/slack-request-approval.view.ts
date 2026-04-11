import { defineView } from 'twenty-sdk';

import {
  SLACK_APPROVAL_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { createSlackRequestBaseViewFields } from 'src/views/slack-request-view-fields';

export default defineView({
  universalIdentifier: SLACK_APPROVAL_VIEW_UNIVERSAL_IDENTIFIER,
  name: '승인 대기',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconHourglass',
  position: 1,
  fields: createSlackRequestBaseViewFields({
    name: 'ec6dd1a6-76cf-4e14-bac9-8bdc4986eb60',
    processingStatus: 'a9cab0f1-638c-4e48-a673-7cfcbcafd11e',
    intentType: 'd237d020-d5bc-4f35-9c40-aba5e57163b5',
    sourceType: '808e4264-ebdb-48f9-bfed-b1d42c57056c',
    slackChannelId: '34569b62-a05b-4eb2-8c32-2780caa3acca',
    confidence: '3a954676-74a0-419a-9851-ae145904ae8f',
    receivedAt: 'fe656ff9-fce2-4105-be20-dc2ef815ebd6',
    lastProcessedAt: '2f0e33ba-18bb-4c37-a7b6-5c585a914bfb',
  }),
  filters: [
    {
      universalIdentifier: 'db7ea517-5096-4b70-a751-af02dfc2e8a1',
      fieldMetadataUniversalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.processingStatus,
      operand: 'IS',
      value: 'AWAITING_CONFIRMATION',
    },
  ],
});
