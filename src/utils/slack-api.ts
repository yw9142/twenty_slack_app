import type { SlackReply, SlackRequestRecord } from 'src/types/slack-agent';
import { getRequiredEnv } from 'src/utils/env';

const SLACK_API_BASE_URL = 'https://slack.com/api';

const parseJsonRecord = (value: string): Record<string, unknown> | null => {
  if (value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const describeSlackFailure = ({
  fallback,
  payload,
}: {
  fallback: string;
  payload: Record<string, unknown> | null;
}): string => {
  if (!payload) {
    return fallback;
  }

  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return `${fallback} (${payload.error})`;
  }

  if (
    typeof payload.message === 'string' &&
    payload.message.trim().length > 0
  ) {
    return `${fallback} (${payload.message})`;
  }

  return fallback;
};

type SlackPostMessageResponse = {
  channel?: string;
  ts?: string;
  ok?: boolean;
};

const slackApiFetch = async <TResponse extends Record<string, unknown>>({
  path,
  body,
}: {
  path: string;
  body: Record<string, unknown>;
}): Promise<TResponse> => {
  const token = getRequiredEnv('SLACK_BOT_TOKEN');
  const response = await fetch(`${SLACK_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  const responsePayload = parseJsonRecord(responseText);

  if (!response.ok) {
    throw new Error(
      describeSlackFailure({
        fallback: `Slack API request failed for ${path}: ${response.status} ${response.statusText}`,
        payload: responsePayload,
      }),
    );
  }

  if (responsePayload?.ok === false) {
    throw new Error(
      describeSlackFailure({
        fallback: `Slack API request was rejected for ${path}`,
        payload: responsePayload,
      }),
    );
  }

  return (responsePayload ?? {}) as TResponse;
};

export const postSlackResponseUrl = async ({
  responseUrl,
  reply,
  replaceOriginal = false,
}: {
  responseUrl: string;
  reply: SlackReply;
  replaceOriginal?: boolean;
}): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      replace_original: replaceOriginal,
      text: reply.text,
      blocks: reply.blocks,
    }),
  });

  const responseText = (await response.text()).trim();
  const responsePayload = parseJsonRecord(responseText);

  if (!response.ok) {
    throw new Error(
      describeSlackFailure({
        fallback: `Slack response_url request failed: ${response.status} ${response.statusText}`,
        payload: responsePayload,
      }),
    );
  }

  if (responsePayload?.ok === false) {
    throw new Error(
      describeSlackFailure({
        fallback: 'Slack response_url request was rejected',
        payload: responsePayload,
      }),
    );
  }

  if (
    !responsePayload &&
    responseText.length > 0 &&
    responseText.toLowerCase() !== 'ok'
  ) {
    throw new Error(`Slack response_url request was rejected (${responseText})`);
  }
};

export const postSlackChannelMessage = async ({
  channelId,
  reply,
  threadTs,
}: {
  channelId: string;
  reply: SlackReply;
  threadTs?: string | null;
}): Promise<{
  channelId: string;
  threadTs: string | null;
  messageTs: string | null;
}> => {
  const response = await slackApiFetch<SlackPostMessageResponse>({
    path: '/chat.postMessage',
    body: {
      channel: channelId,
      text: reply.text,
      thread_ts: threadTs ?? undefined,
      blocks: reply.blocks,
    },
  });

  return {
    channelId: response.channel ?? channelId,
    threadTs: threadTs ?? null,
    messageTs: typeof response.ts === 'string' ? response.ts : null,
  };
};

export const postSlackThreadReply = async ({
  channelId,
  threadTs,
  reply,
}: {
  channelId: string;
  threadTs?: string | null;
  reply: SlackReply;
}): Promise<void> => {
  await postSlackChannelMessage({
    channelId,
    threadTs,
    reply,
  });
};

export const postSlackReplyForRequest = async ({
  slackRequest,
  reply,
  replaceOriginal = false,
}: {
  slackRequest: SlackRequestRecord;
  reply: SlackReply;
  replaceOriginal?: boolean;
}): Promise<void> => {
  if (slackRequest.slackResponseUrl) {
    await postSlackResponseUrl({
      responseUrl: slackRequest.slackResponseUrl,
      reply,
      replaceOriginal,
    });

    return;
  }

  if (!slackRequest.slackChannelId) {
    throw new Error('Slack channel id is required to post a reply');
  }

  await postSlackThreadReply({
    channelId: slackRequest.slackChannelId,
    threadTs: slackRequest.slackThreadTs ?? slackRequest.slackMessageTs,
    reply,
  });
};
