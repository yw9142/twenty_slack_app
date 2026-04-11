import { SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS } from 'src/constants/universal-identifiers';

type SlackRequestBaseViewFieldIds = {
  name: string;
  processingStatus: string;
  intentType: string;
  sourceType: string;
  slackChannelId: string;
  confidence: string;
  receivedAt: string;
  lastProcessedAt: string;
};

export const createSlackRequestBaseViewFields = (
  ids: SlackRequestBaseViewFieldIds,
) => [
  {
    universalIdentifier: ids.name,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.name,
    position: 0,
    isVisible: true,
    size: 220,
  },
  {
    universalIdentifier: ids.processingStatus,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.processingStatus,
    position: 1,
    isVisible: true,
    size: 160,
  },
  {
    universalIdentifier: ids.intentType,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.intentType,
    position: 2,
    isVisible: true,
    size: 150,
  },
  {
    universalIdentifier: ids.sourceType,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.sourceType,
    position: 3,
    isVisible: true,
    size: 150,
  },
  {
    universalIdentifier: ids.slackChannelId,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackChannelId,
    position: 4,
    isVisible: true,
    size: 160,
  },
  {
    universalIdentifier: ids.confidence,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.confidence,
    position: 5,
    isVisible: true,
    size: 120,
  },
  {
    universalIdentifier: ids.receivedAt,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.receivedAt,
    position: 6,
    isVisible: true,
    size: 190,
  },
  {
    universalIdentifier: ids.lastProcessedAt,
    fieldMetadataUniversalIdentifier:
      SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.lastProcessedAt,
    position: 7,
    isVisible: true,
    size: 190,
  },
];

export const createSlackRequestErrorViewField = (universalIdentifier: string) => ({
  universalIdentifier,
  fieldMetadataUniversalIdentifier:
    SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.errorMessage,
  position: 8,
  isVisible: true,
  size: 320,
});
