import { defineView } from 'twenty-sdk';

import {
  SLACK_QUERY_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { createSlackRequestBaseViewFields } from 'src/views/slack-request-view-fields';

export default defineView({
  universalIdentifier: SLACK_QUERY_VIEW_UNIVERSAL_IDENTIFIER,
  name: '질의 이력',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconSearch',
  position: 3,
  fields: createSlackRequestBaseViewFields({
    name: '6b43b852-9f2e-469c-b57b-5c8ae2cc3f72',
    processingStatus: '2f13f5c7-2181-4e96-bf3a-156593d2adf4',
    intentType: 'f4f22bf4-c979-42f6-acd4-ac774585c7d9',
    sourceType: '54650c9c-2fa3-447f-9829-1634a81fc729',
    slackChannelId: 'b4479eae-bd56-4202-8da4-3f24b99a85e4',
    confidence: '3426dff5-94e6-4281-947a-dcf1372d2bf3',
    receivedAt: '5405dd84-2206-4cf1-b5b6-2cae366bca14',
    lastProcessedAt: '61bc58e4-2c9a-4cbc-8cce-8bd8e8644938',
  }),
  filters: [
    {
      universalIdentifier: 'c350ab87-eac8-441d-98b6-6d74c6d5f2c6',
      fieldMetadataUniversalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.intentType,
      operand: 'IS',
      value: 'QUERY',
    },
  ],
});
