import { defineApplication } from 'twenty-sdk';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  applicationVariables: {
    ALLOWED_CHANNEL_IDS: {
      universalIdentifier: '9489113c-eee1-4daa-b515-d873d107b2f0',
      description:
        'Comma-separated Slack channel IDs that the app is allowed to process.',
      value: '',
      isSecret: false,
    },
    ADMIN_SLACK_USER_IDS: {
      universalIdentifier: '8d104689-75bd-45f3-ad52-a4a88aadc477',
      description:
        'Comma-separated Slack user IDs that should receive operational alerts.',
      value: '',
      isSecret: false,
    },
    VENDOR_ALIGNED_STAGE_VALUES: {
      universalIdentifier: '35bfbea9-2e6e-4224-8abe-aa90ea2e8e01',
      description:
        'Comma-separated opportunity stage values that require a primary vendor.',
      value:
        'VENDOR_ALIGNED,DISCOVERY_POC,QUOTED,NEGOTIATION,CLOSED_WON,CLOSED_LOST,ON_HOLD',
      isSecret: false,
    },
    QUOTE_STAGE_VALUES: {
      universalIdentifier: '9c9ad711-4c99-48b6-a6c3-88fb78b7df66',
      description:
        'Comma-separated opportunity stage values that require linked solutions.',
      value: 'QUOTED,NEGOTIATION,CLOSED_WON,CLOSED_LOST',
      isSecret: false,
    },
    MANAGEMENT_CHANNEL_ID: {
      universalIdentifier: '83623a81-cddf-42a6-b3bd-f42d9707704d',
      description:
        'Slack channel ID for weekly briefings and operational notifications.',
      value: '',
      isSecret: false,
    },
  },
  serverVariables: {
    SLACK_BOT_TOKEN: {
      description: 'Slack bot token used for posting replies and notifications.',
      isSecret: true,
      isRequired: true,
    },
    SLACK_SIGNING_SECRET: {
      description: 'Slack signing secret used to verify inbound webhooks.',
      isSecret: true,
      isRequired: true,
    },
    SLACK_VERIFICATION_TOKEN: {
      description:
        'Optional fallback verification token for environments where raw body verification is not available.',
      isSecret: true,
      isRequired: false,
    },
    SLACK_APP_TOKEN: {
      description:
        'Optional Slack app-level token for future Socket Mode support.',
      isSecret: true,
      isRequired: false,
    },
    OPENAI_API_KEY: {
      description: 'OpenAI API key used for intent analysis and draft generation.',
      isSecret: true,
      isRequired: true,
    },
    OPENAI_MODEL: {
      description:
        'OpenAI model ID used for structured query and draft generation.',
      isSecret: false,
      isRequired: false,
    },
    TWENTY_BASE_URL: {
      description:
        'Public Twenty base URL used when generating record links for Slack.',
      isSecret: false,
      isRequired: true,
    },
  },
  defaultRoleUniversalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
});
