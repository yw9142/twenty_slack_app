import {
  createTwentyToolClient,
  processSlackRequestWithCodex,
  startCodexJob,
} from './runner.mjs';

const HTTP_ACCEPTED = 202;

const readJsonBody = (body) => {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return {};
  }

  return JSON.parse(body);
};

export const verifyRunnerSharedSecret = ({
  expectedSecret,
  providedSecret,
}) => {
  if (
    typeof expectedSecret !== 'string' ||
    expectedSecret.length === 0 ||
    typeof providedSecret !== 'string' ||
    providedSecret.length === 0 ||
    expectedSecret.length !== providedSecret.length
  ) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < expectedSecret.length; index += 1) {
    mismatch |= expectedSecret.charCodeAt(index) ^ providedSecret.charCodeAt(index);
  }

  return mismatch === 0;
};

export const handleInternalRunnerRequest = async ({
  method,
  headers = {},
  body,
  runnerSharedSecret,
  toolSharedSecret,
  twentyInternalUrl,
  createToolClient = createTwentyToolClient,
  runCodexJob = processSlackRequestWithCodex,
}) => {
  if (method !== 'POST') {
    return {
      statusCode: 405,
      body: { ok: false, message: 'Method not allowed' },
    };
  }

  if (
    !verifyRunnerSharedSecret({
      expectedSecret: runnerSharedSecret,
      providedSecret: headers['x-runner-shared-secret'],
    })
  ) {
    return {
      statusCode: 401,
      body: { ok: false, message: 'Unauthorized runner request' },
    };
  }

  let payload;

  try {
    payload = readJsonBody(body);
  } catch {
    return {
      statusCode: 400,
      body: { ok: false, message: 'Invalid request body' },
    };
  }

  if (typeof payload.slackRequestId !== 'string' || payload.slackRequestId.length === 0) {
    return {
      statusCode: 400,
      body: { ok: false, message: 'Missing slackRequestId' },
    };
  }

  const toolClient = createToolClient({
    twentyInternalUrl,
    toolSharedSecret,
  });

  startCodexJob({
    slackRequestId: payload.slackRequestId,
    toolClient,
    runCodexJob,
  });

  return {
    statusCode: HTTP_ACCEPTED,
    body: { ok: true, message: 'Runner accepted Slack request' },
  };
};
