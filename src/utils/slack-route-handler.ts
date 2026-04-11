import type { RoutePayload } from 'twenty-sdk';

import type { SlackSourceType } from 'src/constants/slack-intake';
import { getAllowedChannelIds, getOptionalEnv, getRequiredEnv } from 'src/utils/env';
import {
  confirmSlackRequest,
  rejectSlackRequest,
} from 'src/utils/slack-orchestrator';
import { createOrLoadSlackRequest } from 'src/utils/slack-intake-service';
import { verifySlackSignature } from 'src/utils/slack-signature';
import {
  buildDedupeKey,
  getActionValue,
  getRouteBodyText,
  getSlackActionId,
  getSlackVerificationToken,
  parseSlackActionBodyFromRouteBody,
  parseSlackCommandBodyFromRouteBody,
  parseSlackEventEnvelope,
  shouldProcessChannel,
  type SlackIntakeDraft,
} from 'src/utils/slack';
import { truncate } from 'src/utils/strings';

type RouteBody = Record<string, unknown> | string | null;

const nowIso = (): string => new Date().toISOString();

const verifyRequest = ({
  event,
  rawBody,
}: {
  event: RoutePayload<RouteBody>;
  rawBody: string;
}): boolean => {
  const signingSecret = getRequiredEnv('SLACK_SIGNING_SECRET');
  const providedSignature = event.headers['x-slack-signature'];
  const timestamp = event.headers['x-slack-request-timestamp'];
  const verificationToken = getOptionalEnv('SLACK_VERIFICATION_TOKEN');

  if (
    verifySlackSignature({
      signingSecret,
      providedSignature,
      timestamp,
      rawBody,
    })
  ) {
    return true;
  }

  if (!verificationToken) {
    return false;
  }

  return getSlackVerificationToken(event.body) === verificationToken;
};

const createIntakeName = ({
  sourceType,
  rawText,
}: {
  sourceType: SlackSourceType;
  rawText: string;
}): string => `${sourceType} - ${truncate(rawText || 'empty request', 60)}`;

const buildSlackIntakeDraft = ({
  sourceType,
  rawText,
  teamId,
  channelId,
  threadTs,
  messageTs,
  userId,
  responseUrl,
  dedupeKey,
}: {
  sourceType: SlackSourceType;
  rawText: string;
  teamId?: string;
  channelId?: string;
  threadTs?: string;
  messageTs?: string;
  userId?: string;
  responseUrl?: string;
  dedupeKey: string;
}): SlackIntakeDraft => ({
  name: createIntakeName({ sourceType, rawText }),
  slackTeamId: teamId,
  slackChannelId: channelId,
  slackThreadTs: threadTs,
  slackMessageTs: messageTs,
  slackUserId: userId,
  sourceType,
  slackResponseUrl: responseUrl,
  rawText,
  normalizedText: rawText.trim(),
  processingStatus: 'RECEIVED',
  dedupeKey,
  receivedAt: nowIso(),
});

export const handleSlackEventsRoute = async (
  event: RoutePayload<RouteBody>,
): Promise<Record<string, unknown>> => {
  const rawBody = getRouteBodyText(event.body);

  if (!verifyRequest({ event, rawBody })) {
    return {
      ok: false,
      message: 'Invalid Slack signature',
    };
  }

  const envelope = parseSlackEventEnvelope(event.body);

  if (envelope.type === 'url_verification') {
    return {
      challenge: envelope.challenge ?? '',
    };
  }

  const slackEvent = envelope.event ?? {};
  const eventType =
    typeof slackEvent.type === 'string' ? slackEvent.type : undefined;

  if (eventType !== 'app_mention') {
    return {
      ok: true,
      message: `Ignored Slack event type ${eventType ?? 'unknown'}`,
    };
  }

  const channelId =
    typeof slackEvent.channel === 'string' ? slackEvent.channel : undefined;

  if (!shouldProcessChannel(channelId, getAllowedChannelIds())) {
    return {
      ok: true,
      message: 'Ignored Slack event outside allowed channels',
    };
  }

  const rawText = typeof slackEvent.text === 'string' ? slackEvent.text : '';
  const messageTs = typeof slackEvent.ts === 'string' ? slackEvent.ts : undefined;
  const threadTs =
    typeof slackEvent.thread_ts === 'string'
      ? slackEvent.thread_ts
      : messageTs;

  const draft = buildSlackIntakeDraft({
    sourceType: 'APP_MENTION',
    rawText,
    teamId: envelope.team_id,
    channelId,
    threadTs,
    messageTs,
    userId: typeof slackEvent.user === 'string' ? slackEvent.user : undefined,
    dedupeKey: buildDedupeKey({
      sourceType: 'APP_MENTION',
      teamId: envelope.team_id,
      channelId,
      messageTs,
      eventId: envelope.event_id,
    }),
  });

  await createOrLoadSlackRequest(draft);

  return {
    ok: true,
  };
};

export const handleSlackCommandsRoute = async (
  event: RoutePayload<RouteBody>,
): Promise<Record<string, unknown>> => {
  const rawBody = getRouteBodyText(event.body);

  if (!verifyRequest({ event, rawBody })) {
    return {
      ok: false,
      text: 'Slack 검증에 실패했습니다.',
    };
  }

  const payload = parseSlackCommandBodyFromRouteBody(event.body);

  if (!shouldProcessChannel(payload.channelId, getAllowedChannelIds())) {
    return {
      ok: true,
      text: '허용된 채널이 아니라 요청을 무시했습니다.',
    };
  }

  const draft = buildSlackIntakeDraft({
    sourceType: 'SLASH_COMMAND',
    rawText: payload.text ?? '',
    teamId: payload.teamId,
    channelId: payload.channelId,
    messageTs: payload.messageTs,
    threadTs: payload.messageTs,
    userId: payload.userId,
    responseUrl: payload.responseUrl,
    dedupeKey: buildDedupeKey({
      sourceType: 'SLASH_COMMAND',
      teamId: payload.teamId,
      channelId: payload.channelId,
      messageTs: payload.messageTs,
      actionId: payload.command,
    }),
  });

  await createOrLoadSlackRequest(draft);

  return {
    ok: true,
    text: '요청을 접수했습니다. 결과를 곧 스레드에 올릴게요.',
  };
};

export const handleSlackInteractivityRoute = async (
  event: RoutePayload<RouteBody>,
): Promise<Record<string, unknown>> => {
  const rawBody = getRouteBodyText(event.body);

  if (!verifyRequest({ event, rawBody })) {
    return {
      ok: false,
      text: 'Slack 검증에 실패했습니다.',
    };
  }

  const payload = parseSlackActionBodyFromRouteBody(event.body);
  const action = payload.actions?.[0];
  const actionId = getSlackActionId(action);
  const slackRequestId = getActionValue(action);

  if (!actionId || !slackRequestId) {
    return {
      ok: true,
      text: '처리할 액션 정보를 찾지 못했습니다.',
    };
  }

  if (actionId === 'approve_slack_request') {
    await confirmSlackRequest({
      slackRequestId,
      approvedBySlackUserId: payload.user?.id,
    });

    return {
      ok: true,
      text: '승인 요청을 반영했습니다.',
    };
  }

  if (actionId === 'reject_slack_request') {
    await rejectSlackRequest({
      slackRequestId,
      reason: 'Slack 승인 카드에서 취소됨',
    });

    return {
      ok: true,
      text: '반영 요청을 취소했습니다.',
    };
  }

  return {
    ok: true,
    text: `알 수 없는 액션 ${actionId}`,
  };
};
