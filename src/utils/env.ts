import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_MANAGEMENT_CHANNEL_FALLBACK,
} from 'src/constants/slack-intake';

const normalizeList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const getRequiredEnv = (key: string): string => {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const getOptionalEnv = (key: string): string | undefined => {
  const value = process.env[key];

  return value && value.length > 0 ? value : undefined;
};

export const getAllowedChannelIds = (): string[] =>
  normalizeList(process.env.ALLOWED_CHANNEL_IDS);

export const getAdminSlackUserIds = (): string[] =>
  normalizeList(process.env.ADMIN_SLACK_USER_IDS);

export const getManagementChannelId = (): string =>
  process.env.MANAGEMENT_CHANNEL_ID ?? DEFAULT_MANAGEMENT_CHANNEL_FALLBACK;

export const getAnthropicModel = (): string =>
  process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;

export const getConfiguredStageValues = (key: string, fallback: string[]): string[] => {
  const parsed = normalizeList(process.env[key]);

  return parsed.length > 0 ? parsed : fallback;
};
