import {
  SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS,
} from 'src/constants/universal-identifiers';
import type {
  SlackRequestRecord,
  SlackThreadContextPatch,
  SlackThreadContextRecord,
  SlackThreadEntityReferenceKind,
  SlackThreadLastQuerySnapshot,
  SlackThreadPendingApproval,
  SlackThreadSummary,
  SlackThreadTurn,
  SlackThreadWorkingContext,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import {
  findSlackRequestsByThread,
} from 'src/utils/slack-intake-service';

const nowIso = (): string => new Date().toISOString();

const slackThreadContextSelection = {
  id: true,
  name: true,
  slackTeamId: true,
  slackChannelId: true,
  slackThreadTs: true,
  threadKey: true,
  summaryJson: true,
  recentTurnsJson: true,
  contextJson: true,
  pendingApprovalJson: true,
  lastSlackRequestId: true,
  lastRepliedAt: true,
} as const;

const EMPTY_SUMMARY: SlackThreadSummary = {
  text: '',
};

const EMPTY_CONTEXT: SlackThreadWorkingContext = {
  selectedCompanyIds: [],
  selectedPersonIds: [],
  selectedOpportunityIds: [],
  selectedLicenseIds: [],
  lastQuerySnapshot: null,
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const toStringValue = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const parseJsonTextField = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
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

const serializeJsonTextField = (
  value: unknown,
): Record<string, unknown> | string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return JSON.stringify(value);
};

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const normalizeSummaryJson = (value: unknown): SlackThreadSummary => {
  const record = parseJsonTextField(value);

  return {
    text: toStringValue(record?.text) ?? '',
  };
};

const normalizeLastQuerySnapshot = (
  value: unknown,
): SlackThreadLastQuerySnapshot | null => {
  const record = toRecord(value);
  const requestId = toStringValue(record?.requestId);

  if (!requestId) {
    return null;
  }

  const items = Array.isArray(record?.items)
      ? record.items
        .map((item) => {
          const itemRecord = toRecord(item);
          const id = toStringValue(itemRecord?.id);
          const kind = toStringValue(itemRecord?.kind);
          const label = toStringValue(itemRecord?.label);
          const order =
            typeof itemRecord?.order === 'number' ? itemRecord.order : 0;

          if (
            !id ||
            !kind ||
            !label ||
            (kind !== 'company' &&
              kind !== 'person' &&
              kind !== 'opportunity' &&
              kind !== 'license')
          ) {
            return null;
          }

          const normalizedKind: SlackThreadEntityReferenceKind | null =
            kind === 'company' ||
            kind === 'person' ||
            kind === 'opportunity' ||
            kind === 'license'
              ? kind
              : null;

          if (!normalizedKind || !itemRecord) {
            return null;
          }

          return {
            id,
            kind: normalizedKind,
            label,
            order,
            summary: toStringValue(itemRecord.summary),
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  return {
    requestId,
    items,
  };
};

const normalizeContextJson = (value: unknown): SlackThreadWorkingContext => {
  const record = parseJsonTextField(value);

  return {
    selectedCompanyIds: normalizeStringArray(record?.selectedCompanyIds),
    selectedPersonIds: normalizeStringArray(record?.selectedPersonIds),
    selectedOpportunityIds: normalizeStringArray(record?.selectedOpportunityIds),
    selectedLicenseIds: normalizeStringArray(record?.selectedLicenseIds),
    lastQuerySnapshot: normalizeLastQuerySnapshot(record?.lastQuerySnapshot),
  };
};

const normalizeTurnOutcome = (value: unknown): SlackThreadTurn['outcome'] => {
  if (
    value === 'query' ||
    value === 'write_draft' ||
    value === 'applied' ||
    value === 'rejected' ||
    value === 'system'
  ) {
    return value;
  }

  return null;
};

const normalizeRecentTurnsJson = (value: unknown): SlackThreadTurn[] => {
  const record = parseJsonTextField(value);
  const turns = Array.isArray(record?.turns) ? record.turns : Array.isArray(value) ? value : [];

  return turns
    .map((turn) => {
      const turnRecord = toRecord(turn);
      const requestId = toStringValue(turnRecord?.requestId);

      if (!requestId || !turnRecord) {
        return null;
      }

      return {
        requestId,
        userText: toStringValue(turnRecord.userText),
        assistantText: toStringValue(turnRecord.assistantText),
        outcome: normalizeTurnOutcome(turnRecord.outcome),
      };
    })
    .filter((turn): turn is SlackThreadTurn => Boolean(turn))
    .slice(-6);
};

const normalizePendingApprovalJson = (
  value: unknown,
): SlackThreadPendingApproval | null => {
  const record = parseJsonTextField(value);
  const sourceSlackRequestId = toStringValue(record?.sourceSlackRequestId);
  const summary = toStringValue(record?.summary);
  const actions = Array.isArray(record?.actions) ? record.actions : null;

  if (!sourceSlackRequestId || !summary || !actions) {
    return null;
  }

  const approvalRecord = record as NonNullable<typeof record>;

  return {
    sourceSlackRequestId,
    summary,
    actions: actions as SlackThreadPendingApproval['actions'],
    review: toRecord(approvalRecord.review) as SlackThreadPendingApproval['review'],
    status:
      typeof approvalRecord.status === 'string'
        ? (approvalRecord.status as SlackThreadPendingApproval['status'])
        : null,
  };
};

const normalizeThreadContextNode = (
  node: Record<string, unknown> | null | undefined,
): SlackThreadContextRecord | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }

  return {
    id: typeof node.id === 'string' ? node.id : '',
    name: toStringValue(node.name),
    slackTeamId: toStringValue(node.slackTeamId),
    slackChannelId: toStringValue(node.slackChannelId),
    slackThreadTs: toStringValue(node.slackThreadTs),
    threadKey: toStringValue(node.threadKey) ?? '',
    summaryJson: normalizeSummaryJson(node.summaryJson),
    recentTurnsJson: normalizeRecentTurnsJson(node.recentTurnsJson),
    contextJson: normalizeContextJson(node.contextJson),
    pendingApprovalJson: normalizePendingApprovalJson(node.pendingApprovalJson),
    lastSlackRequestId: toStringValue(node.lastSlackRequestId),
    lastRepliedAt: toStringValue(node.lastRepliedAt),
  };
};

const normalizeThreadContextMutationData = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const normalizedData = { ...data };

  if ('summaryJson' in normalizedData) {
    normalizedData.summaryJson = serializeJsonTextField(normalizedData.summaryJson);
  }

  if ('recentTurnsJson' in normalizedData) {
    normalizedData.recentTurnsJson = serializeJsonTextField(
      normalizedData.recentTurnsJson,
    );
  }

  if ('contextJson' in normalizedData) {
    normalizedData.contextJson = serializeJsonTextField(normalizedData.contextJson);
  }

  if ('pendingApprovalJson' in normalizedData) {
    normalizedData.pendingApprovalJson = serializeJsonTextField(
      normalizedData.pendingApprovalJson,
    );
  }

  return normalizedData;
};

const getSlackRequestText = (slackRequest: SlackRequestRecord): string | null =>
  slackRequest.normalizedText ?? slackRequest.rawText;

const getSlackRequestReplyText = (slackRequest: SlackRequestRecord): string | null => {
  const resultJson = toRecord(slackRequest.resultJson);
  const reply = toRecord(resultJson?.reply);

  if (toStringValue(reply?.text)) {
    return toStringValue(reply?.text);
  }

  if (
    slackRequest.processingStatus === 'AWAITING_CONFIRMATION' &&
    toStringValue(toRecord(slackRequest.draftJson)?.summary)
  ) {
    return `CRM 반영 초안을 만들었습니다. ${toStringValue(
      toRecord(slackRequest.draftJson)?.summary,
    )}`;
  }

  if (slackRequest.processingStatus === 'REJECTED') {
    return 'CRM 반영 요청을 취소했습니다.';
  }

  if (slackRequest.processingStatus === 'ERROR' && slackRequest.errorMessage) {
    return slackRequest.errorMessage;
  }

  return null;
};

const getRecoveredTurnOutcome = (
  slackRequest: SlackRequestRecord,
): SlackThreadTurn['outcome'] => {
  if (slackRequest.processingStatus === 'ANSWERED') {
    return 'query';
  }

  if (slackRequest.processingStatus === 'AWAITING_CONFIRMATION') {
    return 'write_draft';
  }

  if (slackRequest.processingStatus === 'APPLIED') {
    return 'applied';
  }

  if (slackRequest.processingStatus === 'REJECTED') {
    return 'rejected';
  }

  return 'system';
};

const extractStoredThreadContextPatch = (
  slackRequest: SlackRequestRecord,
): Record<string, unknown> | null =>
  toRecord(toRecord(slackRequest.resultJson)?.threadContextPatch);

const buildRecoveredPendingApproval = (
  slackRequest: SlackRequestRecord,
): SlackThreadPendingApproval | null => {
  const draft = toRecord(slackRequest.draftJson);
  const summary = toStringValue(draft?.summary);
  const actions = Array.isArray(draft?.actions) ? draft.actions : null;

  if (
    slackRequest.processingStatus !== 'AWAITING_CONFIRMATION' ||
    !draft ||
    !summary ||
    !actions
  ) {
    return null;
  }

  return {
    sourceSlackRequestId: slackRequest.id,
    summary,
    actions: actions as SlackThreadPendingApproval['actions'],
    review: toRecord(draft.review) as SlackThreadPendingApproval['review'],
    status: slackRequest.processingStatus,
  };
};

const appendTurn = ({
  existingTurns,
  turn,
}: {
  existingTurns: SlackThreadTurn[];
  turn: SlackThreadTurn;
}): SlackThreadTurn[] => {
  const nextTurns = [...existingTurns];
  const existingTurnIndex = nextTurns.findIndex(
    (existingTurn) => existingTurn.requestId === turn.requestId,
  );

  if (existingTurnIndex >= 0) {
    nextTurns[existingTurnIndex] = {
      ...nextTurns[existingTurnIndex],
      ...turn,
    };
  } else {
    nextTurns.push(turn);
  }

  return nextTurns.slice(-6);
};

const recoverThreadContextFromRequests = ({
  currentSlackRequest,
  threadRequests,
}: {
  currentSlackRequest: SlackRequestRecord;
  threadRequests: SlackRequestRecord[];
}): Pick<
  SlackThreadContextRecord,
  'summaryJson' | 'recentTurnsJson' | 'contextJson' | 'pendingApprovalJson'
> => {
  const previousRequests = threadRequests
    .filter((request) => request.id !== currentSlackRequest.id)
    .slice(-3);
  let summaryJson = { ...EMPTY_SUMMARY };
  let contextJson = { ...EMPTY_CONTEXT };
  let pendingApprovalJson: SlackThreadPendingApproval | null = null;
  const recentTurnsJson = previousRequests
    .map((request) => ({
      requestId: request.id,
      userText: getSlackRequestText(request),
      assistantText: getSlackRequestReplyText(request),
      outcome: getRecoveredTurnOutcome(request),
    }))
    .filter(
      (turn): turn is SlackThreadTurn =>
        Boolean(turn.userText || turn.assistantText),
    );

  for (const request of previousRequests) {
    const storedPatch = extractStoredThreadContextPatch(request);

    if (toStringValue(storedPatch?.summary)) {
      summaryJson = {
        text: toStringValue(storedPatch?.summary) ?? '',
      };
    }

    if (storedPatch?.selectedEntities) {
      const selectedEntities = toRecord(storedPatch.selectedEntities);

      contextJson = {
        ...contextJson,
        ...(selectedEntities
          ? {
              selectedCompanyIds:
                normalizeStringArray(selectedEntities.companyIds).length > 0
                  ? normalizeStringArray(selectedEntities.companyIds)
                  : contextJson.selectedCompanyIds,
              selectedPersonIds:
                normalizeStringArray(selectedEntities.personIds).length > 0
                  ? normalizeStringArray(selectedEntities.personIds)
                  : contextJson.selectedPersonIds,
              selectedOpportunityIds:
                normalizeStringArray(selectedEntities.opportunityIds).length > 0
                  ? normalizeStringArray(selectedEntities.opportunityIds)
                  : contextJson.selectedOpportunityIds,
              selectedLicenseIds:
                normalizeStringArray(selectedEntities.licenseIds).length > 0
                  ? normalizeStringArray(selectedEntities.licenseIds)
                  : contextJson.selectedLicenseIds,
            }
          : {}),
      };
    }

    if ('lastQuerySnapshot' in (storedPatch ?? {})) {
      contextJson = {
        ...contextJson,
        lastQuerySnapshot: normalizeLastQuerySnapshot(storedPatch?.lastQuerySnapshot),
      };
    }
  }

  for (const request of [...previousRequests].reverse()) {
    const recoveredPendingApproval = buildRecoveredPendingApproval(request);

    if (recoveredPendingApproval) {
      pendingApprovalJson = recoveredPendingApproval;
      break;
    }
  }

  return {
    summaryJson,
    recentTurnsJson,
    contextJson,
    pendingApprovalJson,
  };
};

const buildPendingApprovalJson = ({
  existingPendingApproval,
  patch,
  slackRequest,
}: {
  existingPendingApproval: SlackThreadPendingApproval | null;
  patch: SlackThreadContextPatch;
  slackRequest: SlackRequestRecord;
}): SlackThreadPendingApproval | null => {
  if (patch.pendingApproval && typeof patch.pendingApproval === 'object') {
    return patch.pendingApproval;
  }

  if (patch.pendingApproval !== null) {
    return existingPendingApproval;
  }

  if (patch.assistantTurn.outcome === 'query') {
    return existingPendingApproval;
  }

  if (patch.assistantTurn.outcome === 'applied') {
    return null;
  }

  if (
    patch.assistantTurn.outcome === 'rejected' &&
    existingPendingApproval?.sourceSlackRequestId !== slackRequest.id
  ) {
    return existingPendingApproval;
  }

  return null;
};

const mergeSelectedEntities = ({
  currentContext,
  patch,
}: {
  currentContext: SlackThreadWorkingContext;
  patch: SlackThreadContextPatch;
}): SlackThreadWorkingContext => ({
  selectedCompanyIds:
    patch.selectedEntities.companyIds ?? currentContext.selectedCompanyIds,
  selectedPersonIds:
    patch.selectedEntities.personIds ?? currentContext.selectedPersonIds,
  selectedOpportunityIds:
    patch.selectedEntities.opportunityIds ?? currentContext.selectedOpportunityIds,
  selectedLicenseIds:
    patch.selectedEntities.licenseIds ?? currentContext.selectedLicenseIds,
  lastQuerySnapshot:
    'lastQuerySnapshot' in patch
      ? patch.lastQuerySnapshot ?? null
      : currentContext.lastQuerySnapshot,
});

const createSlackThreadContext = async ({
  slackRequest,
  recoveredContext,
}: {
  slackRequest: SlackRequestRecord;
  recoveredContext: Pick<
    SlackThreadContextRecord,
    'summaryJson' | 'recentTurnsJson' | 'contextJson' | 'pendingApprovalJson'
  >;
}): Promise<SlackThreadContextRecord> => {
  const client = createCoreClient();
  const response = await client.mutation<{
    createSlackThreadContext?: Record<string, unknown>;
  }>({
    createSlackThreadContext: {
      __args: {
        data: normalizeThreadContextMutationData({
          name: buildSlackThreadKey(slackRequest),
          slackTeamId: slackRequest.slackTeamId,
          slackChannelId: slackRequest.slackChannelId,
          slackThreadTs: slackRequest.slackThreadTs,
          threadKey: buildSlackThreadKey(slackRequest),
          summaryJson: recoveredContext.summaryJson,
          recentTurnsJson: recoveredContext.recentTurnsJson,
          contextJson: recoveredContext.contextJson,
          pendingApprovalJson: recoveredContext.pendingApprovalJson,
          lastSlackRequestId:
            recoveredContext.recentTurnsJson[
              recoveredContext.recentTurnsJson.length - 1
            ]?.requestId ?? null,
          lastRepliedAt: null,
        }),
      },
      ...slackThreadContextSelection,
    },
  });

  const record = normalizeThreadContextNode(response.createSlackThreadContext);

  if (!record) {
    throw new Error('Failed to create Slack thread context');
  }

  return record;
};

export const buildSlackThreadKey = (
  slackRequest: Pick<
    SlackRequestRecord,
    'slackTeamId' | 'slackChannelId' | 'slackThreadTs'
  >,
): string =>
  [
    slackRequest.slackTeamId ?? '',
    slackRequest.slackChannelId ?? '',
    slackRequest.slackThreadTs ?? '',
  ].join(':');

export const findSlackThreadContextByThreadKey = async (
  threadKey: string,
): Promise<SlackThreadContextRecord | null> => {
  const client = createCoreClient();
  const response = await client.query<{
    slackThreadContexts?: {
      edges: Array<{ node: Record<string, unknown> }>;
    };
  }>({
    slackThreadContexts: {
      __args: {
        filter: {
          threadKey: {
            eq: threadKey,
          },
        },
      },
      edges: {
        node: slackThreadContextSelection,
      },
    },
  });

  return normalizeThreadContextNode(response.slackThreadContexts?.edges[0]?.node);
};

export const updateSlackThreadContext = async ({
  id,
  data,
}: {
  id: string;
  data: Record<string, unknown>;
}): Promise<SlackThreadContextRecord> => {
  const client = createCoreClient();
  const response = await client.mutation<{
    updateSlackThreadContext?: Record<string, unknown>;
  }>({
    updateSlackThreadContext: {
      __args: {
        id,
        data: normalizeThreadContextMutationData(data),
      },
      ...slackThreadContextSelection,
    },
  });

  const record = normalizeThreadContextNode(response.updateSlackThreadContext);

  if (!record) {
    throw new Error(`Failed to update Slack thread context ${id}`);
  }

  return record;
};

export const loadOrCreateThreadContextForSlackRequest = async (
  slackRequest: SlackRequestRecord,
): Promise<SlackThreadContextRecord> => {
  const threadKey = buildSlackThreadKey(slackRequest);
  const existing = await findSlackThreadContextByThreadKey(threadKey);

  if (existing) {
    return existing;
  }

  const threadRequests =
    slackRequest.slackTeamId &&
    slackRequest.slackChannelId &&
    slackRequest.slackThreadTs
      ? await findSlackRequestsByThread({
          slackTeamId: slackRequest.slackTeamId,
          slackChannelId: slackRequest.slackChannelId,
          slackThreadTs: slackRequest.slackThreadTs,
        })
      : [];

  return createSlackThreadContext({
    slackRequest,
    recoveredContext: recoverThreadContextFromRequests({
      currentSlackRequest: slackRequest,
      threadRequests,
    }),
  });
};

export const applyThreadContextPatchToSlackRequest = async ({
  slackRequest,
  patch,
}: {
  slackRequest: SlackRequestRecord;
  patch: SlackThreadContextPatch;
}): Promise<SlackThreadContextRecord> => {
  const currentThreadContext = await loadOrCreateThreadContextForSlackRequest(
    slackRequest,
  );

  return updateSlackThreadContext({
    id: currentThreadContext.id,
    data: {
      summaryJson: {
        text: patch.summary,
      },
      recentTurnsJson: appendTurn({
        existingTurns: currentThreadContext.recentTurnsJson,
        turn: {
          requestId: slackRequest.id,
          userText: getSlackRequestText(slackRequest),
          assistantText: patch.assistantTurn.text,
          outcome: patch.assistantTurn.outcome,
        },
      }),
      contextJson: mergeSelectedEntities({
        currentContext: currentThreadContext.contextJson,
        patch,
      }),
      pendingApprovalJson: buildPendingApprovalJson({
        existingPendingApproval: currentThreadContext.pendingApprovalJson,
        patch,
        slackRequest,
      }),
      lastSlackRequestId: slackRequest.id,
      lastRepliedAt: nowIso(),
    },
  });
};

export const buildEmptyThreadContextRecord = (
  slackRequest: SlackRequestRecord,
): Omit<SlackThreadContextRecord, 'id'> => ({
  name: buildSlackThreadKey(slackRequest),
  slackTeamId: slackRequest.slackTeamId,
  slackChannelId: slackRequest.slackChannelId,
  slackThreadTs: slackRequest.slackThreadTs,
  threadKey: buildSlackThreadKey(slackRequest),
  summaryJson: { ...EMPTY_SUMMARY },
  recentTurnsJson: [],
  contextJson: { ...EMPTY_CONTEXT },
  pendingApprovalJson: null,
  lastSlackRequestId: null,
  lastRepliedAt: null,
});

export const SLACK_THREAD_CONTEXT_FIELD_NAMES =
  SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS;
