import { defineView, ViewKey } from 'twenty-sdk';

import {
  SLACK_APPROVAL_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_ERROR_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_QUERY_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_VIEW_UNIVERSAL_IDENTIFIER,
  SLACK_WRITE_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

const baseFields = [
  {
    universalIdentifier: '22bb2c82-614b-4f2c-8023-2a879204efbb',
    fieldMetadataUniversalIdentifier: SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.name,
    position: 0,
    isVisible: true,
    size: 220,
  },
  {
    universalIdentifier: '865397ba-9a69-490d-b34e-ec69ddf6bd37',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.processingStatus,
    position: 1,
    isVisible: true,
    size: 160,
  },
  {
    universalIdentifier: 'b504dc50-43d9-4bc6-97c0-dcb52261d631',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.intentType,
    position: 2,
    isVisible: true,
    size: 150,
  },
  {
    universalIdentifier: '8d7458a4-83c2-4b67-b375-414bb5a6153e',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.sourceType,
    position: 3,
    isVisible: true,
    size: 150,
  },
  {
    universalIdentifier: '1094f88b-e0fd-4e7e-a2b5-5aa894595bf7',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackChannelId,
    position: 4,
    isVisible: true,
    size: 160,
  },
  {
    universalIdentifier: '98a5bc95-c5ab-432f-a384-b66165529817',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.confidence,
    position: 5,
    isVisible: true,
    size: 120,
  },
  {
    universalIdentifier: 'e5b75b57-6d52-4160-adab-c2ba4d1f3dba',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.receivedAt,
    position: 6,
    isVisible: true,
    size: 190,
  },
  {
    universalIdentifier: '4f9eafb0-089b-47c5-a15c-eda2d295ac05',
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.lastProcessedAt,
    position: 7,
    isVisible: true,
    size: 190,
  },
] as const;

export const approvalQueueView = defineView({
  universalIdentifier: SLACK_APPROVAL_VIEW_UNIVERSAL_IDENTIFIER,
  name: '승인 대기',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconHourglass',
  position: 1,
  fields: [...baseFields],
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

export const errorQueueView = defineView({
  universalIdentifier: SLACK_ERROR_VIEW_UNIVERSAL_IDENTIFIER,
  name: '오류',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconAlertTriangle',
  position: 2,
  fields: [
    ...baseFields,
    {
      universalIdentifier: '59251340-a107-44fa-b34e-005963d13960',
      fieldMetadataUniversalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.errorMessage,
      position: 8,
      isVisible: true,
      size: 320,
    },
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

export const queryHistoryView = defineView({
  universalIdentifier: SLACK_QUERY_VIEW_UNIVERSAL_IDENTIFIER,
  name: '질의 이력',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconSearch',
  position: 3,
  fields: [...baseFields],
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

export const writeDraftView = defineView({
  universalIdentifier: SLACK_WRITE_VIEW_UNIVERSAL_IDENTIFIER,
  name: '쓰기 초안 이력',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconPencilSparkles',
  position: 4,
  fields: [...baseFields],
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

export default defineView({
  universalIdentifier: SLACK_REQUEST_VIEW_UNIVERSAL_IDENTIFIER,
  name: '전체 Slack 요청',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconBrandSlack',
  key: ViewKey.INDEX,
  position: 0,
  fields: [...baseFields],
});
