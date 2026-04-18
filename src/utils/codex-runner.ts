import { getRunnerBaseUrl, getRunnerSharedSecret } from 'src/utils/env';
import { updateSlackRequest } from 'src/utils/slack-intake-service';

const getRunnerErrorMessage = (
  payload: Record<string, unknown> | null,
  fallbackMessage: string,
): string => {
  if (payload && typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message;
  }

  return fallbackMessage;
};

export const postSlackRequestToRunner = async ({
  slackRequestId,
}: {
  slackRequestId: string;
}): Promise<void> => {
  const response = await fetch(
    new URL('/internal/slack-requests/process', getRunnerBaseUrl()).toString(),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-runner-shared-secret': getRunnerSharedSecret(),
      },
      body: JSON.stringify({
        slackRequestId,
      }),
    },
  );

  const responseText = await response.text();
  const payload =
    responseText.length > 0
      ? (JSON.parse(responseText) as Record<string, unknown>)
      : null;

  if (!response.ok) {
    throw new Error(
      getRunnerErrorMessage(
        payload,
        `Runner rejected Slack request ${slackRequestId}: ${response.status} ${response.statusText}`,
      ),
    );
  }

  if (payload?.ok === false) {
    throw new Error(
      getRunnerErrorMessage(payload, `Runner failed Slack request ${slackRequestId}`),
    );
  }
};

export const handoffSlackRequestToRunner = async ({
  slackRequestId,
}: {
  slackRequestId: string;
}): Promise<'PROCESSING' | 'ERROR'> => {
  try {
    await postSlackRequestToRunner({
      slackRequestId,
    });

    return 'PROCESSING';
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to hand off to runner';

    await updateSlackRequest({
      id: slackRequestId,
      data: {
        processingStatus: 'ERROR',
        errorMessage,
        lastProcessedAt: new Date().toISOString(),
      },
    });

    return 'ERROR';
  }
};
