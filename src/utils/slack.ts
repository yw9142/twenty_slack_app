import type { RoutePayload } from 'twenty-sdk';

import type { IntentType, SlackSourceType } from 'src/constants/slack-intake';

type RouteBody = Record<string, unknown> | string | null;

export type SlackEventEnvelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: Record<string, unknown>;
};

export type SlackCommandPayload = {
  teamId?: string;
  channelId?: string;
  userId?: string;
  text?: string;
  command?: string;
  responseUrl?: string;
  triggerId?: string;
  messageTs?: string;
  token?: string;
};

export type SlackActionPayload = {
  type?: string;
  token?: string;
  user?: { id?: string };
  channel?: { id?: string };
  container?: { thread_ts?: string; message_ts?: string };
  response_url?: string;
  actions?: Array<Record<string, unknown>>;
};

export type SlackIntakeDraft = {
  name: string;
  slackTeamId?: string;
  slackChannelId?: string;
  slackThreadTs?: string;
  slackMessageTs?: string;
  slackUserId?: string;
  sourceType: SlackSourceType;
  slackResponseUrl?: string;
  rawText?: string;
  normalizedText?: string;
  intentType?: IntentType;
  confidence?: number;
  dedupeKey: string;
  receivedAt: string;
};

export const getRouteBodyText = (body: RouteBody): string => {
  if (typeof body === 'string') {
    return body;
  }

  if (!body) {
    return '';
  }

  return JSON.stringify(body);
};

const getRouteBodyRecord = (body: RouteBody): Record<string, unknown> =>
  body && typeof body === 'object' ? body : {};

export const parseUrlEncodedBody = (bodyText: string): URLSearchParams =>
  new URLSearchParams(bodyText);

export const parseSlackCommandBody = (bodyText: string): SlackCommandPayload => {
  const params = parseUrlEncodedBody(bodyText);

  return {
    teamId: params.get('team_id') ?? undefined,
    channelId: params.get('channel_id') ?? undefined,
    userId: params.get('user_id') ?? undefined,
    text: params.get('text') ?? undefined,
    command: params.get('command') ?? undefined,
    responseUrl: params.get('response_url') ?? undefined,
    triggerId: params.get('trigger_id') ?? undefined,
    messageTs: params.get('message_ts') ?? undefined,
    token: params.get('token') ?? undefined,
  };
};

export const parseSlackCommandBodyFromRouteBody = (
  body: RouteBody,
): SlackCommandPayload => {
  if (typeof body === 'string') {
    return parseSlackCommandBody(body);
  }

  const record = getRouteBodyRecord(body);

  return {
    teamId: typeof record.team_id === 'string' ? record.team_id : undefined,
    channelId:
      typeof record.channel_id === 'string' ? record.channel_id : undefined,
    userId: typeof record.user_id === 'string' ? record.user_id : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
    command: typeof record.command === 'string' ? record.command : undefined,
    responseUrl:
      typeof record.response_url === 'string' ? record.response_url : undefined,
    triggerId:
      typeof record.trigger_id === 'string' ? record.trigger_id : undefined,
    messageTs:
      typeof record.message_ts === 'string' ? record.message_ts : undefined,
    token: typeof record.token === 'string' ? record.token : undefined,
  };
};

export const parseSlackActionBody = (bodyText: string): SlackActionPayload => {
  const params = parseUrlEncodedBody(bodyText);
  const payload = params.get('payload');

  if (!payload) {
    return {};
  }

  return JSON.parse(payload) as SlackActionPayload;
};

export const parseSlackActionBodyFromRouteBody = (
  body: RouteBody,
): SlackActionPayload => {
  if (typeof body === 'string') {
    return parseSlackActionBody(body);
  }

  const record = getRouteBodyRecord(body);
  const payload = record.payload;

  if (typeof payload === 'string') {
    return JSON.parse(payload) as SlackActionPayload;
  }

  if (payload && typeof payload === 'object') {
    return payload as SlackActionPayload;
  }

  return record as SlackActionPayload;
};

export const parseSlackEventEnvelope = (
  body: RouteBody,
): SlackEventEnvelope => {
  if (typeof body === 'string') {
    return JSON.parse(body) as SlackEventEnvelope;
  }

  return (body ?? {}) as SlackEventEnvelope;
};

export const getSlackVerificationToken = (body: RouteBody): string | undefined => {
  if (typeof body === 'string') {
    const params = parseUrlEncodedBody(body);
    const directToken = params.get('token');

    if (directToken) {
      return directToken;
    }

    try {
      const parsed = JSON.parse(body) as { token?: unknown };

      return typeof parsed.token === 'string' ? parsed.token : undefined;
    } catch {
      return undefined;
    }
  }

  const record = getRouteBodyRecord(body);

  return typeof record.token === 'string' ? record.token : undefined;
};

export const buildDedupeKey = ({
  sourceType,
  teamId,
  channelId,
  messageTs,
  actionId,
  eventId,
}: {
  sourceType: SlackSourceType;
  teamId?: string;
  channelId?: string;
  messageTs?: string;
  actionId?: string;
  eventId?: string;
}): string => {
  if (eventId) {
    return `${sourceType}:${eventId}`;
  }

  return [sourceType, teamId, channelId, messageTs, actionId]
    .filter((value) => value && value.length > 0)
    .join(':');
};

export const shouldProcessChannel = (
  channelId: string | undefined,
  allowedChannelIds: string[],
): boolean =>
  allowedChannelIds.length === 0 ||
  (channelId !== undefined && allowedChannelIds.includes(channelId));

export const getActionValue = (
  action: Record<string, unknown> | undefined,
): string | undefined => {
  const value = action?.value;

  return typeof value === 'string' ? value : undefined;
};

export const getSlackActionId = (
  action: Record<string, unknown> | undefined,
): string | undefined => {
  const actionId = action?.action_id;

  return typeof actionId === 'string' ? actionId : undefined;
};

export const isJsonRouteBody = (event: RoutePayload<RouteBody>): boolean => {
  const contentType = event.headers['content-type'] ?? '';

  return contentType.includes('application/json');
};
