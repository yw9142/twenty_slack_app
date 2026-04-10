import type { SlackReply, SlackRequestRecord } from 'src/types/slack-agent';
import { getRequiredEnv } from 'src/utils/env';

const SLACK_API_BASE_URL = 'https://slack.com/api';

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

  if (!response.ok) {
    throw new Error(
      `Slack API request failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as TResponse;
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
  await fetch(responseUrl, {
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
  await slackApiFetch({
    path: '/chat.postMessage',
    body: {
      channel: channelId,
      text: reply.text,
      thread_ts: threadTs ?? undefined,
      blocks: reply.blocks,
    },
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
