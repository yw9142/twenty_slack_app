import { defineView, ViewKey } from 'twenty-sdk';

import {
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  SLACK_REQUEST_VIEW_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { createSlackRequestBaseViewFields } from 'src/views/slack-request-view-fields';

export default defineView({
  universalIdentifier: SLACK_REQUEST_VIEW_UNIVERSAL_IDENTIFIER,
  name: '전체 Slack 요청',
  objectUniversalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  icon: 'IconBrandSlack',
  key: ViewKey.INDEX,
  position: 0,
  fields: createSlackRequestBaseViewFields({
    name: '02e4054a-c8fc-45b1-9a3a-0d858f6ed33b',
    processingStatus: 'b78a7135-ae3a-4dc9-ad35-a2d8da5c0d8b',
    intentType: '6d676f45-eb64-4b2b-8a30-79ff6bced441',
    sourceType: '569ef980-ef08-4ba9-abeb-db62c6c37d3e',
    slackChannelId: 'de18987c-9c01-4936-a52e-44402f950d00',
    confidence: 'ef03d0d4-6c5e-4bf5-8d54-1fa3c630c5c6',
    receivedAt: '7bb653bf-c152-4084-8866-04305aca15e8',
    lastProcessedAt: '8b879eab-2129-4ec1-a654-2c8ecb4ad03e',
  }),
});
