import { defineView } from 'twenty-sdk';

import {
  SLACK_ERROR_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import {
  createSlackRequestBaseViewFields,
  createSlackRequestErrorViewField,
} from 'src/views/slack-request-view-fields';

export default defineView({
  universalIdentifier: SLACK_ERROR_VIEW_UNIVERSAL_IDENTIFIER,
  name: '오류',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconAlertTriangle',
  position: 2,
  fields: [
    ...createSlackRequestBaseViewFields({
      name: 'dd0fa627-30f6-4ff0-966e-03a3958cfa9e',
      processingStatus: '03f59b9a-18f8-4374-8c2a-ab8e557720a5',
      intentType: 'c1e36ed4-cd03-43f7-8762-ec377f27da11',
      sourceType: '275429fe-8de0-4472-94ad-8975df03a0d1',
      slackChannelId: '0648a68c-7fcb-4c6d-b20c-89d1ad6c2381',
      confidence: 'a5ad868c-8fd8-4a2d-bc88-3b766569fe44',
      receivedAt: '08187e19-1bbd-4a74-b0fd-6a565237545f',
      lastProcessedAt: '951bc60e-2a7a-4e24-b29e-11507420fb52',
    }),
    createSlackRequestErrorViewField(
      '815eb73a-8a99-4d8b-b1b0-4d17503c89c1',
    ),
  ],
  filters: [
    {
      universalIdentifier: '64cf3620-c782-44ca-8105-5c9b1cf46bfa',
      fieldMetadataUniversalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.processingStatus,
      operand: 'IS',
      value: 'ERROR',
    },
  ],
});
