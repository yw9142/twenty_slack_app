import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeBaseUrl } from './lib.mjs';

const DEFAULT_MAX_STEPS = 8;

const READ_ONLY_TOOL_NAMES = [
  'load-slack-request',
  'search-companies',
  'search-people',
  'search-opportunities',
  'search-licenses',
  'search-activities',
];

const INTERNAL_ONLY_TOOL_NAMES = [
  'save-query-answer',
  'save-write-draft',
  'mark-runner-error',
  'post-slack-reply',
];

const ALLOWED_TOOL_NAMES = new Set(READ_ONLY_TOOL_NAMES);

const stripCodeFence = (value) => {
  const trimmed = value.trim();

  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
};

const parseDecisionJson = (value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const rawValue = stripCodeFence(value);

  return JSON.parse(rawValue);
};

const normalizeDecision = (decision) => {
  if (!decision || typeof decision !== 'object') {
    throw new Error('Codex returned an empty decision');
  }

  if (decision.kind === 'tool_call') {
    if (typeof decision.endpoint !== 'string' || decision.endpoint.length === 0) {
      throw new Error('Codex tool call is missing an endpoint');
    }

    return {
      kind: 'tool_call',
      endpoint: decision.endpoint,
      payload:
        decision.payload && typeof decision.payload === 'object'
          ? decision.payload
          : {},
    };
  }

  if (decision.kind === 'final') {
    const mode = decision.mode ?? (decision.draft ? 'write_draft' : 'query');
    const message = decision.message ?? decision.answer ?? '';

    if (mode !== 'query' && mode !== 'write_draft') {
      throw new Error(`Unsupported Codex final mode: ${mode}`);
    }

    return {
      kind: 'final',
      mode,
      message,
      draft:
        decision.draft && typeof decision.draft === 'object'
          ? decision.draft
          : undefined,
      diagnostics:
        decision.diagnostics && typeof decision.diagnostics === 'object'
          ? decision.diagnostics
          : undefined,
    };
  }

  if (decision.kind === 'error') {
    return {
      kind: 'error',
      message:
        typeof decision.message === 'string'
          ? decision.message
          : 'Codex returned an error',
      diagnostics:
        decision.diagnostics && typeof decision.diagnostics === 'object'
          ? decision.diagnostics
          : undefined,
    };
  }

  if (typeof decision.endpoint === 'string') {
    return normalizeDecision({
      kind: 'tool_call',
      endpoint: decision.endpoint,
      payload: decision.payload,
    });
  }

  throw new Error('Codex returned an unsupported decision shape');
};

export const buildCodexPrompt = ({
  slackRequestId,
  slackRequest,
  history,
}) => {
  return [
    'You are a Slack-to-Twenty CRM orchestration agent.',
    'Use exactly one tool at a time.',
    'Start by reading the provided request context.',
    `You may only call these read tools: ${READ_ONLY_TOOL_NAMES.join(', ')}.`,
    `The following tools are internal-only and must not be called directly: ${INTERNAL_ONLY_TOOL_NAMES.join(', ')}.`,
    'For read-only questions, end with {"kind":"final","mode":"query","message":"..."}.',
    'For write requests, end with {"kind":"final","mode":"write_draft","message":"...","draft":{...}}.',
    'Never claim to have executed a tool unless the history shows it.',
    'Request context:',
    JSON.stringify({ slackRequestId, slackRequest, history }, null, 2),
    'Return only valid JSON.',
  ].join('\n');
};

export const createCodexCliDecisionRunner = ({
  codexBinary = process.env.CODEX_BINARY ?? 'codex',
  codexHome = process.env.CODEX_HOME,
  model = process.env.CODEX_MODEL,
  workingDirectory = process.env.CODEX_WORKDIR ?? process.cwd(),
} = {}) => {
  return async ({ prompt }) => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'twenty-codex-'));
    const lastMessagePath = join(tempDirectory, 'last-message.txt');

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--full-auto',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--output-last-message',
      lastMessagePath,
      '--cd',
      workingDirectory,
      '-',
    ];

    if (model) {
      args.splice(1, 0, '--model', model);
    }

    await new Promise((resolve, reject) => {
      const child = spawn(codexBinary, args, {
        env: {
          ...process.env,
          ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        },
        stdio: ['pipe', 'ignore', 'pipe'],
      });

      let stderr = '';

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (exitCode) => {
        if (exitCode !== 0) {
          reject(
            new Error(
              stderr.trim() ||
                `Codex CLI exited with status ${exitCode ?? 'unknown'}`,
            ),
          );

          return;
        }

        resolve(undefined);
      });

      child.stdin.end(prompt);
    });

    const lastMessage = await readFile(lastMessagePath, 'utf8');

    await rm(tempDirectory, { recursive: true, force: true });

    return normalizeDecision(parseDecisionJson(lastMessage));
  };
};

export const createTwentyToolClient = ({
  twentyInternalUrl,
  toolSharedSecret,
  fetchImpl = fetch,
} = {}) => {
  const baseUrl = normalizeBaseUrl(twentyInternalUrl ?? 'http://server:3000');

  return {
    callTool: async (endpoint, payload = {}) => {
      const response = await fetchImpl(`${baseUrl}/s/tools/${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tool-shared-secret': toolSharedSecret ?? '',
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          text || `Twenty tool ${endpoint} failed with status ${response.status}`,
        );
      }

      const parsedResponse = text.trim().length > 0 ? JSON.parse(text) : {};

      if (
        parsedResponse &&
        typeof parsedResponse === 'object' &&
        parsedResponse.ok === false
      ) {
        throw new Error(
          typeof parsedResponse.message === 'string' &&
            parsedResponse.message.length > 0
            ? parsedResponse.message
            : `Twenty tool ${endpoint} returned ok=false`,
        );
      }

      return parsedResponse;
    },
  };
};

const isFailureResponse = (value) =>
  Boolean(value) && typeof value === 'object' && value.ok === false;

const getFailureMessage = (value, fallbackMessage) =>
  typeof value?.message === 'string' && value.message.length > 0
    ? value.message
    : fallbackMessage;

const recordRunnerFailure = async ({
  slackRequestId,
  toolClient,
  errorMessage,
  diagnostics,
}) => {
  try {
    await toolClient.callTool('mark-runner-error', {
      slackRequestId,
      errorMessage,
      resultJson: {
        aiDiagnostics: {
          provider: 'codex',
          operation: 'runner_execution',
          attempted: true,
          succeeded: false,
          ...(diagnostics ?? {}),
        },
      },
    });
  } catch {
    // The job has already failed; don't replace it with a secondary error.
  }
};

export const startCodexJob = ({
  slackRequestId,
  toolClient,
  runCodexJob,
}) => {
  void Promise.resolve()
    .then(() =>
      runCodexJob({
        slackRequestId,
        toolClient,
      }),
    )
    .then((result) => {
      if (isFailureResponse(result)) {
        throw new Error(getFailureMessage(result, 'Runner returned ok=false'));
      }
    })
    .catch(async (error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to process Slack request';

      await recordRunnerFailure({
        slackRequestId,
        toolClient,
        errorMessage: message,
      });
    });
};

export const processSlackRequestWithCodex = async ({
  slackRequestId,
  toolClient,
  runCodexDecision = createCodexCliDecisionRunner(),
  maxSteps = DEFAULT_MAX_STEPS,
}) => {
  const effectiveToolClient =
    toolClient ?? createTwentyToolClient({ twentyInternalUrl: undefined });

  const requestRecord = await effectiveToolClient.callTool(
    'load-slack-request',
    {
      slackRequestId,
    },
  );

  const history = [
    {
      type: 'tool_result',
      endpoint: 'load-slack-request',
      result: requestRecord,
    },
  ];

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const prompt = buildCodexPrompt({
      slackRequestId,
      slackRequest: requestRecord,
      history,
    });

    const decision = normalizeDecision(
      await runCodexDecision({
        slackRequestId,
        prompt,
        history,
        slackRequest: requestRecord,
      }),
    );

    if (decision.kind === 'tool_call') {
      if (!ALLOWED_TOOL_NAMES.has(decision.endpoint)) {
        throw new Error(`Disallowed Codex tool call: ${decision.endpoint}`);
      }

      const result = await effectiveToolClient.callTool(
        decision.endpoint,
        decision.payload,
      );

      history.push({
        type: 'tool_result',
        endpoint: decision.endpoint,
        payload: decision.payload,
        result,
      });

      continue;
    }

    if (decision.kind === 'error') {
      await effectiveToolClient.callTool('mark-runner-error', {
        slackRequestId,
        errorMessage: decision.message,
        resultJson: {
          aiDiagnostics: {
            provider: 'codex',
            operation: 'runner_decision',
            attempted: true,
            succeeded: false,
            ...(decision.diagnostics ?? {}),
          },
        },
      });

      return {
        kind: 'error',
        slackRequestId,
        message: decision.message,
      };
    }

    if (decision.mode === 'query') {
      const answer = decision.message;

      await effectiveToolClient.callTool('save-query-answer', {
        slackRequestId,
        reply: {
          text: answer,
        },
        resultJson: {
          aiDiagnostics: {
            provider: 'codex',
            operation: 'query_answer',
            attempted: true,
            succeeded: true,
            ...(decision.diagnostics ?? {}),
          },
        },
      });
      await effectiveToolClient.callTool('post-slack-reply', {
        slackRequestId,
        text: answer,
      });

      return {
        kind: 'query',
        slackRequestId,
        answer,
      };
    }

    if (decision.mode === 'write_draft') {
      await effectiveToolClient.callTool('save-write-draft', {
        slackRequestId,
        draft: decision.draft ?? {},
        resultJson: {
          aiDiagnostics: {
            provider: 'codex',
            operation: 'write_draft',
            attempted: true,
            succeeded: true,
            ...(decision.diagnostics ?? {}),
          },
        },
      });

      return {
        kind: 'write_draft',
        slackRequestId,
        draft: decision.draft ?? {},
      };
    }

    throw new Error('Codex returned an unsupported final decision');
  }

  throw new Error('Codex decision loop exceeded the maximum number of steps');
};
