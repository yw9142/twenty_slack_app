export const SLACK_SOURCE_TYPES = [
  'APP_MENTION',
  'SLASH_COMMAND',
  'INTERACTIVITY',
  'MESSAGE_ACTION',
] as const;

export const INTENT_TYPES = [
  'QUERY',
  'WRITE_DRAFT',
  'APPROVAL_ACTION',
  'UNKNOWN',
] as const;

export const PROCESSING_STATUSES = [
  'RECEIVED',
  'CLASSIFIED',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'APPLIED',
  'ANSWERED',
  'REJECTED',
  'ERROR',
] as const;

export type SlackSourceType = (typeof SLACK_SOURCE_TYPES)[number];
export type IntentType = (typeof INTENT_TYPES)[number];
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_MANAGEMENT_CHANNEL_FALLBACK = '';

export const VENDOR_ALIGNED_STAGE_VALUES = [
  'VENDOR_ALIGNED',
  'DISCOVERY_POC',
  'QUOTED',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
  'ON_HOLD',
] as const;

export const QUOTE_STAGE_VALUES = [
  'QUOTED',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;

export const WON_STAGE_VALUES = ['CLOSED_WON'] as const;
export const LOST_STAGE_VALUES = ['CLOSED_LOST'] as const;
