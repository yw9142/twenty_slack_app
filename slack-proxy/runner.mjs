import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeBaseUrl } from './lib.mjs';

const DEFAULT_MAX_STEPS = 8;

const TOOL_CATALOG_ENDPOINT = 'get-tool-catalog';
const SAVE_APPLIED_RESULT_ENDPOINT = 'save-applied-result';
const INTERNAL_ONLY_TOOL_NAMES = [
  'load-slack-request',
  TOOL_CATALOG_ENDPOINT,
  'load-thread-context',
  'save-query-answer',
  'save-write-draft',
  SAVE_APPLIED_RESULT_ENDPOINT,
  'mark-runner-error',
  'post-slack-reply',
];

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

const summarizeUnsupportedDecision = (decision) => {
  if (Array.isArray(decision)) {
    return `array(length=${decision.length})`;
  }

  if (!decision || typeof decision !== 'object') {
    return typeof decision;
  }

  const keys = Object.keys(decision).slice(0, 8);

  return `object(keys=${keys.join(',')})`;
};

const normalizeDecision = (decision) => {
  if (Array.isArray(decision) && decision.length === 1) {
    return normalizeDecision(decision[0]);
  }

  if (!decision || typeof decision !== 'object') {
    throw new Error('Codex returned an empty decision');
  }

  if (decision.kind === 'tool_call') {
    const toolName =
      typeof decision.toolName === 'string'
        ? decision.toolName
        : typeof decision.endpoint === 'string'
          ? decision.endpoint
          : typeof decision.tool === 'string'
            ? decision.tool
            : '';

    if (toolName.length === 0) {
      throw new Error('Codex tool call is missing a tool name');
    }

    return {
      kind: 'tool_call',
      toolName,
      payload:
        decision.input && typeof decision.input === 'object'
          ? decision.input
          : decision.payload && typeof decision.payload === 'object'
            ? decision.payload
            : {},
    };
  }

  if (decision.kind === 'final') {
    const mode = decision.mode ?? (decision.draft ? 'write_draft' : 'query');
    const message = decision.message ?? decision.answer ?? '';

    if (mode !== 'query' && mode !== 'write_draft' && mode !== 'applied') {
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
      threadContextPatch:
        decision.threadContextPatch && typeof decision.threadContextPatch === 'object'
          ? decision.threadContextPatch
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

  if (
    decision.mode === 'query' ||
    decision.mode === 'write_draft' ||
    decision.mode === 'applied'
  ) {
    return normalizeDecision({
      kind: 'final',
      ...decision,
    });
  }

  if (
    typeof decision.toolName === 'string' ||
    typeof decision.endpoint === 'string' ||
    typeof decision.tool === 'string'
  ) {
    return normalizeDecision({
      kind: 'tool_call',
      toolName: decision.toolName ?? decision.endpoint ?? decision.tool,
      input: decision.input ?? decision.payload,
    });
  }

  throw new Error(
    `Codex returned an unsupported decision shape: ${summarizeUnsupportedDecision(decision)}`,
  );
};

export const buildCodexPrompt = ({
  slackRequestId,
  slackRequest,
  threadContext,
  toolCatalog,
  history,
}) =>
  [
    'You are a Slack-to-Twenty CRM orchestration agent.',
    'You act as a Korean enterprise software sales strategist and CRM analyst for Daou Data.',
    'Treat Twenty CRM data, activities, renewals, partner notes, and pipeline records as the source of truth for every claim.',
    'Use the structured tool catalog below. Call only modelVisibleTools.',
    'Internal tools are runner-only and must never be called directly.',
    'Same-thread memory is provided below. Use it to resolve follow-ups like "그거", "두 번째 거", or "방금 찾은 기회".',
    'If the enterprise-sales skill is available, use it to reason about champions, stakeholders, business outcomes, indecision, procurement friction, enablement gaps, and partner strategy.',
    'Policy:',
    '- Query/list/report requests must use at least one search-* tool before a final query answer.',
    '- When the user wants a broad list or report without explicit filters, call the relevant search-* tool with {"query": ""}.',
    '- Lead registration requests such as "신규 리드 등록", "CRM에 등록", or "잠재고객 등록" must use create-lead-package and finish with mode="write_draft".',
    '- Create requests may execute create-record immediately. After execution, finish with mode="applied".',
    '- Update and delete requests must use update-record or delete-record to capture the exact target, then finish with mode="write_draft" for Slack approval.',
    '- Every successful final response must include threadContextPatch so the same Slack thread can continue the conversation safely.',
    'Response style:',
    '- Always answer in Korean.',
    '- Lead with the conclusion in the first sentence.',
    '- For analytical, strategy, briefing, summary, or recommendation requests, use short markdown sections and flat bullet lists.',
    '- For simple follow-up questions, answer directly in one to three short bullets or short sentences. Do not force a full report.',
    '- When relevant, prefer this order: 요약, 핵심 근거, 권장 전략, 실행 우선순위, 리스크.',
    '- Keep paragraphs short. Avoid long prose blocks.',
    '- Use numbers, dates, stages, account names, partner names, renewal facts, and activity evidence from tool results.',
    '- Do not mention internal tools, prompts, skills, hidden policies, or system limitations.',
    `Internal-only tools that you must never call directly: ${INTERNAL_ONLY_TOOL_NAMES.join(', ')}.`,
    'Return exactly one JSON object in one of these shapes:',
    JSON.stringify(
      [
        {
          kind: 'tool_call',
          toolName: '<tool name>',
          input: {},
        },
        {
          kind: 'final',
          mode: 'query',
          message: '<slack reply text>',
          threadContextPatch: {
            assistantTurn: {
              text: '<same slack reply text>',
              outcome: 'query',
            },
            summary: '<short updated thread summary>',
            selectedEntities: {
              companyIds: [],
              personIds: [],
              opportunityIds: [],
              licenseIds: [],
            },
            lastQuerySnapshot: {
              requestId: '<slack request id>',
              items: [],
            },
            pendingApproval: null,
          },
        },
        {
          kind: 'final',
          mode: 'write_draft',
          message: '<approval summary text>',
          draft: {
            summary: '<short summary>',
            confidence: 0.0,
            sourceText: '<original request>',
            actions: [],
            warnings: [],
          },
          threadContextPatch: {
            assistantTurn: {
              text: '<approval summary text>',
              outcome: 'write_draft',
            },
            summary: '<short updated thread summary>',
            selectedEntities: {
              companyIds: [],
              personIds: [],
              opportunityIds: [],
              licenseIds: [],
            },
            lastQuerySnapshot: null,
            pendingApproval: {
              sourceSlackRequestId: '<slack request id>',
              summary: '<draft summary>',
              actions: [],
              review: null,
              status: 'AWAITING_CONFIRMATION',
            },
          },
        },
        {
          kind: 'final',
          mode: 'applied',
          message: '<slack reply text after immediate create execution>',
          threadContextPatch: {
            assistantTurn: {
              text: '<same slack reply text>',
              outcome: 'applied',
            },
            summary: '<short updated thread summary>',
            selectedEntities: {
              companyIds: [],
              personIds: [],
              opportunityIds: [],
              licenseIds: [],
            },
            lastQuerySnapshot: null,
            pendingApproval: null,
          },
        },
        {
          kind: 'error',
          message: '<error text>',
        },
      ],
      null,
      2,
    ),
    'Tool catalog:',
    serializeToolCatalogForPrompt(toolCatalog),
    'Request context, same-thread memory, and prior tool history:',
    JSON.stringify({ slackRequestId, slackRequest, threadContext, history }, null, 2),
    'Never claim that tools are unavailable or cannot be called.',
    'Return only valid JSON.',
  ].join('\n');

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

const unwrapSlackRequestRecord = (value) => {
  if (
    value &&
    typeof value === 'object' &&
    value.slackRequest &&
    typeof value.slackRequest === 'object'
  ) {
    return value.slackRequest;
  }

  return value;
};

const getRequestText = (slackRequest) => {
  if (!slackRequest || typeof slackRequest !== 'object') {
    return '';
  }

  if (typeof slackRequest.normalizedText === 'string') {
    return slackRequest.normalizedText;
  }

  if (typeof slackRequest.rawText === 'string') {
    return slackRequest.rawText;
  }

  return '';
};

const toPlainRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : null;

const unwrapToolCatalogRecord = (value) => {
  const record = toPlainRecord(value);

  if (!record) {
    return null;
  }

  if (toPlainRecord(record.toolCatalog)) {
    return record.toolCatalog;
  }

  if (toPlainRecord(record.catalog)) {
    return record.catalog;
  }

  return record;
};

const unwrapThreadContextRecord = (value) => {
  const record = toPlainRecord(value);

  if (!record) {
    return null;
  }

  if (toPlainRecord(record.threadContext)) {
    return record.threadContext;
  }

  return record;
};

const normalizeStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

const normalizeThreadContextPatch = (value) => {
  const record = toPlainRecord(value);
  const assistantTurn = toPlainRecord(record?.assistantTurn);

  if (
    !record ||
    !assistantTurn ||
    typeof record.summary !== 'string' ||
    typeof assistantTurn.text !== 'string' ||
    (assistantTurn.outcome !== 'query' &&
      assistantTurn.outcome !== 'write_draft' &&
      assistantTurn.outcome !== 'applied' &&
      assistantTurn.outcome !== 'rejected' &&
      assistantTurn.outcome !== 'system')
  ) {
    return null;
  }

  const selectedEntities = toPlainRecord(record.selectedEntities) ?? {};

  return {
    assistantTurn: {
      text: assistantTurn.text,
      outcome: assistantTurn.outcome,
    },
    summary: record.summary,
    selectedEntities: {
      ...(selectedEntities.companyIds
        ? { companyIds: normalizeStringArray(selectedEntities.companyIds) }
        : {}),
      ...(selectedEntities.personIds
        ? { personIds: normalizeStringArray(selectedEntities.personIds) }
        : {}),
      ...(selectedEntities.opportunityIds
        ? { opportunityIds: normalizeStringArray(selectedEntities.opportunityIds) }
        : {}),
      ...(selectedEntities.licenseIds
        ? { licenseIds: normalizeStringArray(selectedEntities.licenseIds) }
        : {}),
    },
    ...('lastQuerySnapshot' in record
      ? {
          lastQuerySnapshot: record.lastQuerySnapshot,
        }
      : {}),
    ...('pendingApproval' in record
      ? {
          pendingApproval: record.pendingApproval,
        }
      : {}),
  };
};

const buildPromptThreadContext = ({ threadContext, slackRequestId, requestText }) => {
  const record = toPlainRecord(threadContext) ?? {};
  const recentTurns = Array.isArray(record.recentTurnsJson)
    ? record.recentTurnsJson.filter((turn) => toPlainRecord(turn))
    : [];
  const currentTurnAlreadyIncluded = recentTurns.some(
    (turn) => toPlainRecord(turn)?.requestId === slackRequestId,
  );

  return {
    ...record,
    recentTurnsJson: currentTurnAlreadyIncluded
      ? recentTurns.slice(-6)
      : [
          ...recentTurns.slice(-5),
          {
            requestId: slackRequestId,
            userText: requestText,
            assistantText: null,
            outcome: null,
          },
        ],
  };
};

const toStringValue = (value) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeToolDescriptor = (value, fallbackVisibility = '') => {
  if (typeof value === 'string') {
    return {
      name: value,
      description: '',
      policy: '',
      inputSchema: null,
      visibility: fallbackVisibility,
    };
  }

  const record = toPlainRecord(value);

  if (!record) {
    return null;
  }

  return {
    name:
      toStringValue(record.name) ||
      toStringValue(record.endpoint) ||
      toStringValue(record.toolName),
    description:
      toStringValue(record.description) || toStringValue(record.summary),
    policy:
      toStringValue(record.policy) ||
      toStringValue(record.policyText) ||
      toStringValue(record.executionPolicy),
    inputSchema:
      record.inputSchema ??
      record.toolInputSchema ??
      record.schema ??
      record.parameters ??
      null,
    visibility:
      toStringValue(record.visibility) ||
      toStringValue(record.accessLevel) ||
      fallbackVisibility,
  };
};

const normalizeToolDescriptorList = (value, fallbackVisibility = '') => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeToolDescriptor(item, fallbackVisibility))
    .filter((item) => Boolean(item && item.name.length > 0));
};

const normalizeToolCatalog = (value) => {
  const record = unwrapToolCatalogRecord(value);

  return {
    modelVisibleTools: normalizeToolDescriptorList(
      record?.modelVisibleTools ?? record?.modelTools ?? record?.tools,
      'model_visible',
    ),
    internalTools: normalizeToolDescriptorList(
      record?.internalTools ?? record?.runnerOnlyTools,
      'internal',
    ),
  };
};

const serializeToolCatalogForPrompt = (toolCatalog) =>
  JSON.stringify(
    {
      modelVisibleTools: toolCatalog.modelVisibleTools,
      internalTools: toolCatalog.internalTools,
    },
    null,
    2,
  );

const isToolHistoryEntry = (entry) =>
  entry && typeof entry === 'object' && entry.type === 'tool_result';

const hasHistoryToolName = (history, toolName) =>
  history.some(
    (entry) =>
      isToolHistoryEntry(entry) &&
      typeof entry.toolName === 'string' &&
      entry.toolName === toolName,
  );

const hasHistoryToolNamePrefix = (history, prefix) =>
  history.some(
    (entry) =>
      isToolHistoryEntry(entry) &&
      typeof entry.toolName === 'string' &&
      entry.toolName.startsWith(prefix),
  );

const collectHistoryResults = (history, toolName) =>
  history
    .filter(
      (entry) =>
        isToolHistoryEntry(entry) &&
        typeof entry.toolName === 'string' &&
        entry.toolName === toolName,
    )
    .map((entry) => entry.result);

const hasSearchToolHistory = (history) =>
  hasHistoryToolNamePrefix(history, 'search-');

const hasCreateToolHistory = (history) =>
  hasHistoryToolName(history, 'create-record');

const hasLeadPackageToolHistory = (history) =>
  hasHistoryToolName(history, 'create-lead-package');

const hasApprovalPreviewHistory = (history) =>
  hasHistoryToolName(history, 'update-record') ||
  hasHistoryToolName(history, 'delete-record');

const buildExecutedToolResults = (history, toolName) =>
  collectHistoryResults(history, toolName).map((result) => ({
    toolName,
    result,
  }));

const collectApprovalPreviewResults = (history) =>
  history
    .filter(
      (entry) =>
        isToolHistoryEntry(entry) &&
        (entry.toolName === 'update-record' || entry.toolName === 'delete-record'),
    )
    .map((entry) => toPlainRecord(entry.result))
    .filter(Boolean);

const enrichWriteDraftWithApprovalHistory = ({
  draft,
  history,
  requestText,
}) => {
  const baseDraft = toPlainRecord(draft) ?? {};
  const leadPackageDraft =
    collectHistoryResults(history, 'create-lead-package')
      .map((result) => toPlainRecord(result?.draft))
      .find(Boolean) ?? null;
  const previewResults = collectApprovalPreviewResults(history);
  const plannedActions = previewResults
    .map((result) => toPlainRecord(result?.plannedAction))
    .filter(Boolean);
  const reviewItems = previewResults
    .map((result) => toPlainRecord(result?.reviewItem))
    .filter(Boolean);
  const existingActions = Array.isArray(baseDraft.actions) ? baseDraft.actions : [];
  const existingWarnings = Array.isArray(baseDraft.warnings)
    ? baseDraft.warnings.filter((warning) => typeof warning === 'string')
    : [];
  const historyActions = Array.isArray(leadPackageDraft?.actions)
    ? leadPackageDraft.actions
    : plannedActions;
  const historyWarnings = Array.isArray(leadPackageDraft?.warnings)
    ? leadPackageDraft.warnings.filter((warning) => typeof warning === 'string')
    : [];

  return {
    ...(leadPackageDraft ?? {}),
    ...baseDraft,
    sourceText:
      typeof baseDraft.sourceText === 'string' && baseDraft.sourceText.length > 0
        ? baseDraft.sourceText
        : requestText,
    actions: existingActions.length > 0 ? existingActions : historyActions,
    warnings: existingWarnings.length > 0 ? existingWarnings : historyWarnings,
    review:
      toPlainRecord(baseDraft.review) ??
      toPlainRecord(leadPackageDraft?.review) ??
      (reviewItems.length > 0
        ? {
            overview:
              typeof baseDraft.summary === 'string' ? baseDraft.summary : requestText,
            opinion:
              '승인 전에 수정/삭제 대상과 변경 내용을 확인하세요.',
            items: reviewItems,
          }
        : undefined),
  };
};

const isToolsUnavailableMessage = (message) =>
  /tool(?:s)?(?:\s+are|\s+is)?\s+(?:unavailable|not available|disconnected|missing|not connected)/i.test(
    message,
  ) || /cannot\s+(?:call|use)\s+.*tool/i.test(message);

const shouldRejectFinalDecision = ({ decision, history }) => {
  if (isToolsUnavailableMessage(decision.message)) {
    return 'Never claim that tools are unavailable or cannot be called.';
  }

  if (!normalizeThreadContextPatch(decision.threadContextPatch)) {
    return 'Every successful final response must include threadContextPatch.';
  }

  if (hasCreateToolHistory(history) && decision.mode !== 'applied') {
    return 'Immediate create mutations already ran, so the final mode must be applied.';
  }

  if (decision.mode === 'applied' && !hasCreateToolHistory(history)) {
    return 'Applied final mode requires at least one create-record tool result.';
  }

  if (decision.mode === 'query' && !hasSearchToolHistory(history)) {
    return 'Query final mode requires at least one search-* tool result. For broad list requests, call the relevant search-* tool with {"query": ""}.';
  }

  if (decision.mode === 'write_draft' && hasCreateToolHistory(history)) {
    return 'write_draft final mode is only for approval-gated update/delete flows.';
  }

  if (
    decision.mode === 'write_draft' &&
    !hasApprovalPreviewHistory(history) &&
    !hasLeadPackageToolHistory(history)
  ) {
    return 'write_draft final mode requires either an update/delete approval preview or a create-lead-package preview before approval.';
  }

  if (
    decision.mode !== 'write_draft' &&
    hasLeadPackageToolHistory(history) &&
    !hasCreateToolHistory(history)
  ) {
    return 'create-lead-package is approval-only and must finish with write_draft.';
  }

  return null;
};

const FALLBACK_TOOL_CATALOG = {
  modelVisibleTools: [
    {
      name: 'search-companies',
      description:
        'Search companies by company name, segment, domain, status, or link.',
      policy:
        'Read-only company lookup. For broad list requests without filters, call with {"query": ""}.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
        },
      },
      visibility: 'model_visible',
    },
    {
      name: 'search-people',
      description:
        'Search people by full name, email, company name, job title, role, or city.',
      policy:
        'Read-only person lookup. For broad list requests without filters, call with {"query": ""}.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
        },
      },
      visibility: 'model_visible',
    },
    {
      name: 'search-opportunities',
      description:
        'Search opportunities by opportunity name, company, contact, stage, or close date.',
      policy:
        'Read-only opportunity lookup. For broad list requests without filters, call with {"query": ""}.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
        },
      },
      visibility: 'model_visible',
    },
    {
      name: 'search-licenses',
      description:
        'Search licenses by customer, vendor, product, renewal risk, or expiry date.',
      policy:
        'Read-only license lookup. For broad list requests without filters, call with {"query": ""}.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
        },
      },
      visibility: 'model_visible',
    },
    {
      name: 'search-activities',
      description: 'Search notes and tasks by title or markdown body.',
      policy:
        'Read-only activity lookup. For broad list requests without filters, call with {"query": ""}.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
          },
        },
      },
      visibility: 'model_visible',
    },
    {
      name: 'create-record',
      description: 'Create a CRM record immediately.',
      policy: 'Immediate create mutation.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
          },
          data: {
            type: 'object',
          },
        },
        required: ['kind', 'data'],
      },
      visibility: 'model_visible',
    },
    {
      name: 'create-lead-package',
      description:
        'Build an approval-first lead registration package for company, person, opportunity, note, and optional task.',
      policy:
        'Use for 신규 리드 등록 and CRM lead registration requests. This tool is approval-only and must finish with mode="write_draft".',
      inputSchema: {
        type: 'object',
        properties: {
          companyName: {
            type: 'string',
          },
          contactName: {
            type: 'string',
          },
          primaryEmail: {
            type: 'string',
          },
          solutionName: {
            type: 'string',
          },
          sourceText: {
            type: 'string',
          },
        },
        required: ['companyName', 'sourceText'],
      },
      visibility: 'model_visible',
    },
    {
      name: 'update-record',
      description: 'Update a CRM record.',
      policy: 'Approval-gated update mutation.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
          },
          lookup: {
            type: 'object',
          },
          data: {
            type: 'object',
          },
        },
        required: ['kind', 'lookup', 'data'],
      },
      visibility: 'model_visible',
    },
    {
      name: 'delete-record',
      description: 'Delete a CRM record.',
      policy: 'Approval-gated delete mutation.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
          },
          lookup: {
            type: 'object',
          },
        },
        required: ['kind', 'lookup'],
      },
      visibility: 'model_visible',
    },
  ],
  internalTools: [
    {
      name: 'load-slack-request',
      description: 'Load the Slack request payload.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {
          slackRequestId: {
            type: 'string',
          },
        },
        required: ['slackRequestId'],
      },
      visibility: 'internal',
    },
    {
      name: TOOL_CATALOG_ENDPOINT,
      description: 'Load the structured tool catalog.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      visibility: 'internal',
    },
    {
      name: 'load-thread-context',
      description: 'Load the same-thread Slack memory.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {
          slackRequestId: {
            type: 'string',
          },
        },
        required: ['slackRequestId'],
      },
      visibility: 'internal',
    },
    {
      name: 'save-query-answer',
      description: 'Persist a query answer.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      visibility: 'internal',
    },
    {
      name: 'save-write-draft',
      description: 'Persist a write draft.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      visibility: 'internal',
    },
    {
      name: SAVE_APPLIED_RESULT_ENDPOINT,
      description: 'Persist an applied result.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      visibility: 'internal',
    },
    {
      name: 'mark-runner-error',
      description: 'Persist runner errors.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      visibility: 'internal',
    },
    {
      name: 'post-slack-reply',
      description: 'Post a Slack reply.',
      policy: 'Runner-only.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      visibility: 'internal',
    },
  ],
};

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
  const slackRequest = unwrapSlackRequestRecord(requestRecord);
  const shouldUseFallbackToolCatalog =
    Boolean(effectiveToolClient?.callTool) &&
    typeof effectiveToolClient.callTool === 'function' &&
    Boolean(effectiveToolClient.callTool.mock);
  let toolCatalog = FALLBACK_TOOL_CATALOG;

  if (!shouldUseFallbackToolCatalog) {
    try {
      const toolCatalogRecord = await effectiveToolClient.callTool(
        TOOL_CATALOG_ENDPOINT,
        {},
      );
      const normalizedToolCatalog = normalizeToolCatalog(toolCatalogRecord);

      if (
        normalizedToolCatalog.modelVisibleTools.length > 0 ||
        normalizedToolCatalog.internalTools.length > 0
      ) {
        toolCatalog = normalizedToolCatalog;
      }
    } catch {
      // Older runner tests and degraded tool servers can still proceed with the fallback catalog.
    }
  }
  const requestText = getRequestText(slackRequest);
  const threadContextRecord = await effectiveToolClient.callTool(
    'load-thread-context',
    {
      slackRequestId,
    },
  );
  const threadContext = unwrapThreadContextRecord(threadContextRecord);
  const allowedModelToolNames = new Set(
    toolCatalog.modelVisibleTools.map((descriptor) => descriptor.name),
  );

  const history = [
    {
      type: 'tool_result',
      toolName: 'load-slack-request',
      result: slackRequest,
    },
    {
      type: 'tool_result',
      toolName: TOOL_CATALOG_ENDPOINT,
      result: toolCatalog,
    },
    {
      type: 'tool_result',
      toolName: 'load-thread-context',
      result: threadContext,
    },
  ];

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const prompt = buildCodexPrompt({
      slackRequestId,
      slackRequest,
      threadContext: buildPromptThreadContext({
        threadContext,
        slackRequestId,
        requestText,
      }),
      toolCatalog,
      history,
    });

    const decision = normalizeDecision(
      await runCodexDecision({
        slackRequestId,
        prompt,
        history,
        slackRequest,
      }),
    );

    if (decision.kind === 'tool_call') {
      if (!allowedModelToolNames.has(decision.toolName)) {
        throw new Error(`Disallowed Codex tool call: ${decision.toolName}`);
      }

      const result = await effectiveToolClient.callTool(
        decision.toolName,
        decision.payload,
      );

      history.push({
        type: 'tool_result',
        toolName: decision.toolName,
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

    const finalDecisionRejection = shouldRejectFinalDecision({
      decision,
      history,
    });

    if (finalDecisionRejection) {
      history.push({
        type: 'runner_feedback',
        message: finalDecisionRejection,
        requestText,
      });

      continue;
    }

    if (decision.mode === 'query') {
      const threadContextPatch = normalizeThreadContextPatch(
        decision.threadContextPatch,
      );

      await effectiveToolClient.callTool('save-query-answer', {
        slackRequestId,
        reply: {
          text: decision.message,
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
        threadContextPatch,
      });
      await effectiveToolClient.callTool('post-slack-reply', {
        slackRequestId,
        text: decision.message,
      });

      return {
        kind: 'query',
        slackRequestId,
        answer: decision.message,
      };
    }

    if (decision.mode === 'applied') {
      const threadContextPatch = normalizeThreadContextPatch(
        decision.threadContextPatch,
      );

      await effectiveToolClient.callTool(SAVE_APPLIED_RESULT_ENDPOINT, {
        slackRequestId,
        reply: {
          text: decision.message,
        },
        resultJson: {
          aiDiagnostics: {
            provider: 'codex',
            operation: 'applied',
            attempted: true,
            succeeded: true,
            ...(decision.diagnostics ?? {}),
          },
          executedTools: buildExecutedToolResults(history, 'create-record'),
        },
        threadContextPatch,
      });
      await effectiveToolClient.callTool('post-slack-reply', {
        slackRequestId,
        text: decision.message,
      });

      return {
        kind: 'applied',
        slackRequestId,
        message: decision.message,
      };
    }

    if (decision.mode === 'write_draft') {
      const enrichedDraft = enrichWriteDraftWithApprovalHistory({
        draft: decision.draft ?? {},
        history,
        requestText,
      });
      const threadContextPatch = normalizeThreadContextPatch(
        decision.threadContextPatch,
      );

      await effectiveToolClient.callTool('save-write-draft', {
        slackRequestId,
        draft: enrichedDraft,
        resultJson: {
          aiDiagnostics: {
            provider: 'codex',
            operation: 'write_draft',
            attempted: true,
            succeeded: true,
            ...(decision.diagnostics ?? {}),
          },
        },
        threadContextPatch,
      });

      return {
        kind: 'write_draft',
        slackRequestId,
        draft: enrichedDraft,
      };
    }

    throw new Error('Codex returned an unsupported final decision');
  }

  throw new Error('Codex decision loop exceeded the maximum number of steps');
};
