import type { RoutePayload } from 'twenty-sdk';

import { getToolSharedSecret } from 'src/utils/env';
import {
  executeImmediateCreateAction,
  previewApprovalAction,
} from 'src/utils/crm-write';
import {
  fetchCompanies,
  fetchLicenses,
  fetchNotes,
  fetchOpportunities,
  fetchPeople,
  fetchTasks,
} from 'src/utils/crm-query';
import type {
  CrmActionRecord,
  CrmWriteDraft,
  SlackReply,
  SlackThreadContextPatch,
  SlackThreadPendingApproval,
} from 'src/types/slack-agent';
import { postSlackReplyForRequest } from 'src/utils/slack-api';
import {
  findSlackRequestById,
  updateSlackRequest,
} from 'src/utils/slack-intake-service';
import {
  applyThreadContextPatchToSlackRequest,
  loadOrCreateThreadContextForSlackRequest,
} from 'src/utils/slack-thread-context-service';
import { buildApprovalReply } from 'src/utils/slack-orchestrator';
import { normalizeText } from 'src/utils/strings';
import { getToolCatalog, isEntityKind } from 'src/utils/tool-catalog';

type RouteBody = Record<string, unknown> | string | null;

type ToolRoutePayload = RoutePayload<RouteBody>;

const nowIso = (): string => new Date().toISOString();

const toRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;

      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const toStringValue = (
  record: Record<string, unknown>,
  key: string,
): string => {
  const value = record[key];

  return typeof value === 'string' ? value.trim() : '';
};

const toBooleanValue = (
  record: Record<string, unknown>,
  key: string,
): boolean => record[key] === true;

const toRecordValue = (
  value: unknown,
): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isAuthorized = (event: ToolRoutePayload): boolean =>
  event.headers['x-tool-shared-secret'] === getToolSharedSecret();

const rejectToolRequest = (): Record<string, unknown> => ({
  ok: false,
  message: 'Invalid tool shared secret',
});

const getDiagnosticsPatch = (
  resultJson: Record<string, unknown>,
): Record<string, unknown> | undefined =>
  toRecordValue(resultJson.aiDiagnostics) ??
  toRecordValue(resultJson.runnerDiagnostics) ??
  undefined;

const mergeResultJson = ({
  current,
  patch,
}: {
  current: Record<string, unknown> | null;
  patch: Record<string, unknown>;
}): Record<string, unknown> => {
  const currentRecord = current ?? {};
  const patchRecord = patch ?? {};
  const currentDiagnostics = toRecordValue(currentRecord.aiDiagnostics);
  const patchDiagnostics = toRecordValue(patchRecord.aiDiagnostics);

  return {
    ...currentRecord,
    ...patchRecord,
    ...(currentDiagnostics || patchDiagnostics
      ? {
          aiDiagnostics: {
            ...(currentDiagnostics ?? {}),
            ...(patchDiagnostics ?? {}),
          },
        }
      : {}),
  };
};

const matchesQuery = (
  haystacks: Array<string | null | undefined>,
  query: string,
): boolean => {
  const normalizedQuery = normalizeText(query);

  if (normalizedQuery.length === 0) {
    return true;
  }

  return haystacks.some((haystack) =>
    normalizeText(haystack ?? '').includes(normalizedQuery),
  );
};

const getSlackRequestId = (record: Record<string, unknown>): string =>
  toStringValue(record, 'slackRequestId');

const getReply = (record: Record<string, unknown>): SlackReply | null => {
  const reply = toRecordValue(record.reply);
  const text = toStringValue(record, 'text');

  if (reply) {
    return {
      text: typeof reply.text === 'string' ? reply.text : text,
      blocks: Array.isArray(reply.blocks)
        ? (reply.blocks as SlackReply['blocks'])
        : undefined,
    };
  }

  if (text.length > 0) {
    return {
      text,
    };
  }

  return null;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

const toPendingApproval = (value: unknown): SlackThreadPendingApproval | null => {
  const record = toRecordValue(value);
  const summary = typeof record?.summary === 'string' ? record.summary : null;
  const sourceSlackRequestId =
    typeof record?.sourceSlackRequestId === 'string'
      ? record.sourceSlackRequestId
      : null;
  const actions = Array.isArray(record?.actions) ? record.actions : null;

  if (!summary || !sourceSlackRequestId || !actions) {
    return null;
  }

  const approvalRecord = record as NonNullable<typeof record>;

  return {
    sourceSlackRequestId,
    summary,
    actions: actions as SlackThreadPendingApproval['actions'],
    review: toRecordValue(approvalRecord.review) as SlackThreadPendingApproval['review'],
    status:
      typeof approvalRecord.status === 'string'
        ? (approvalRecord.status as SlackThreadPendingApproval['status'])
        : null,
  };
};

const getThreadContextPatch = (
  record: Record<string, unknown>,
): SlackThreadContextPatch | null => {
  const patch = toRecordValue(record.threadContextPatch);
  const assistantTurn = toRecordValue(patch?.assistantTurn);

  if (!patch || !assistantTurn || typeof patch.summary !== 'string') {
    return null;
  }

  const outcome = assistantTurn.outcome;

  if (
    typeof assistantTurn.text !== 'string' ||
    (outcome !== 'query' &&
      outcome !== 'write_draft' &&
      outcome !== 'applied' &&
      outcome !== 'rejected' &&
      outcome !== 'system')
  ) {
    return null;
  }

  const selectedEntities = toRecordValue(patch.selectedEntities) ?? {};
  const lastQuerySnapshot = toRecordValue(patch.lastQuerySnapshot);

  return {
    assistantTurn: {
      text: assistantTurn.text,
      outcome,
    },
    summary: patch.summary,
    selectedEntities: {
      ...(selectedEntities.companyIds
        ? { companyIds: toStringArray(selectedEntities.companyIds) }
        : {}),
      ...(selectedEntities.personIds
        ? { personIds: toStringArray(selectedEntities.personIds) }
        : {}),
      ...(selectedEntities.opportunityIds
        ? { opportunityIds: toStringArray(selectedEntities.opportunityIds) }
        : {}),
      ...(selectedEntities.licenseIds
        ? { licenseIds: toStringArray(selectedEntities.licenseIds) }
        : {}),
    },
    ...('lastQuerySnapshot' in patch
      ? {
          lastQuerySnapshot: lastQuerySnapshot
            ? ({
                requestId:
                  typeof lastQuerySnapshot.requestId === 'string'
                    ? lastQuerySnapshot.requestId
                    : '',
                items: Array.isArray(lastQuerySnapshot.items)
                  ? (lastQuerySnapshot.items as Array<Record<string, unknown>>).map(
                      (item, index) => ({
                        id: typeof item.id === 'string' ? item.id : '',
                        kind:
                          item.kind === 'company' ||
                          item.kind === 'person' ||
                          item.kind === 'opportunity' ||
                          item.kind === 'license'
                            ? item.kind
                            : 'company',
                        label: typeof item.label === 'string' ? item.label : '',
                        order:
                          typeof item.order === 'number' ? item.order : index,
                        summary:
                          typeof item.summary === 'string'
                            ? item.summary
                            : null,
                      }),
                    )
                  : [],
              } satisfies NonNullable<SlackThreadContextPatch['lastQuerySnapshot']>)
            : null,
        }
      : {}),
    ...('pendingApproval' in patch
      ? {
          pendingApproval:
            patch.pendingApproval === null
              ? null
              : toPendingApproval(patch.pendingApproval),
        }
      : {}),
  };
};

const buildFallbackQueryPatch = ({
  slackRequestId,
  reply,
}: {
  slackRequestId: string;
  reply: SlackReply;
}): SlackThreadContextPatch => ({
  assistantTurn: {
    text: reply.text,
    outcome: 'query',
  },
  summary: reply.text,
  selectedEntities: {},
  lastQuerySnapshot: {
    requestId: slackRequestId,
    items: [],
  },
  pendingApproval: null,
});

const buildPendingApprovalFromDraft = ({
  slackRequestId,
  draft,
}: {
  slackRequestId: string;
  draft: Record<string, unknown>;
}): SlackThreadPendingApproval => ({
  sourceSlackRequestId: slackRequestId,
  summary: typeof draft.summary === 'string' ? draft.summary : '',
  actions: Array.isArray(draft.actions)
    ? (draft.actions as SlackThreadPendingApproval['actions'])
    : [],
  review: toRecordValue(draft.review) as SlackThreadPendingApproval['review'],
  status: 'AWAITING_CONFIRMATION',
});

const buildFallbackWriteDraftPatch = ({
  slackRequestId,
  draft,
}: {
  slackRequestId: string;
  draft: Record<string, unknown>;
}): SlackThreadContextPatch => ({
  assistantTurn: {
    text: `CRM 반영 초안을 만들었습니다. ${
      typeof draft.summary === 'string' ? draft.summary : ''
    }`.trim(),
    outcome: 'write_draft',
  },
  summary: typeof draft.summary === 'string' ? draft.summary : '',
  selectedEntities: {},
  lastQuerySnapshot: null,
  pendingApproval: buildPendingApprovalFromDraft({
    slackRequestId,
    draft,
  }),
});

const buildFallbackAppliedPatch = ({
  reply,
  resultJson,
}: {
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}): SlackThreadContextPatch => {
  const executedTools = Array.isArray(resultJson.executedTools)
    ? resultJson.executedTools
    : [];
  const companyIds: string[] = [];
  const personIds: string[] = [];
  const opportunityIds: string[] = [];

  for (const executedTool of executedTools) {
    const actionResult = toRecordValue(
      toRecordValue(toRecordValue(executedTool)?.result)?.actionResult,
    );

    if (
      typeof actionResult?.id === 'string' &&
      typeof actionResult.kind === 'string'
    ) {
      if (actionResult.kind === 'company') {
        companyIds.push(actionResult.id);
      }

      if (actionResult.kind === 'person') {
        personIds.push(actionResult.id);
      }

      if (actionResult.kind === 'opportunity') {
        opportunityIds.push(actionResult.id);
      }
    }
  }

  return {
    assistantTurn: {
      text: reply.text,
      outcome: 'applied',
    },
    summary: reply.text,
    selectedEntities: {
      ...(companyIds.length > 0 ? { companyIds } : {}),
      ...(personIds.length > 0 ? { personIds } : {}),
      ...(opportunityIds.length > 0 ? { opportunityIds } : {}),
    },
    lastQuerySnapshot: null,
    pendingApproval: null,
  };
};

const normalizeCompany = (company: Record<string, unknown>): Record<string, unknown> => ({
  id: typeof company.id === 'string' ? company.id : '',
  name: typeof company.name === 'string' ? company.name : null,
  accountSegment:
    typeof company.accountSegment === 'string' ? company.accountSegment : null,
  businessUnit:
    typeof company.businessUnit === 'string' ? company.businessUnit : null,
  companyStatus:
    typeof company.companyStatus === 'string' ? company.companyStatus : null,
  domainName:
    typeof company.domainName === 'string' ? company.domainName : null,
  linkedinLink:
    typeof company.linkedinLink === 'string' ? company.linkedinLink : null,
  employees: typeof company.employees === 'number' ? company.employees : null,
});

const normalizePerson = (person: Record<string, unknown>): Record<string, unknown> => ({
  id: typeof person.id === 'string' ? person.id : '',
  fullName: typeof person.fullName === 'string' ? person.fullName : '',
  primaryEmail:
    typeof person.primaryEmail === 'string' ? person.primaryEmail : null,
  jobTitle: typeof person.jobTitle === 'string' ? person.jobTitle : null,
  companyName:
    typeof person.companyName === 'string' ? person.companyName : null,
  contactRoleType:
    typeof person.contactRoleType === 'string' ? person.contactRoleType : null,
  city: typeof person.city === 'string' ? person.city : null,
  linkedinLink:
    typeof person.linkedinLink === 'string' ? person.linkedinLink : null,
});

const normalizeOpportunity = (
  opportunity: Record<string, unknown>,
): Record<string, unknown> => ({
  id: typeof opportunity.id === 'string' ? opportunity.id : '',
  name: typeof opportunity.name === 'string' ? opportunity.name : '',
  stage: typeof opportunity.stage === 'string' ? opportunity.stage : null,
  closeDate:
    typeof opportunity.closeDate === 'string' ? opportunity.closeDate : null,
  companyName:
    typeof opportunity.companyName === 'string' ? opportunity.companyName : null,
  pointOfContactName:
    typeof opportunity.pointOfContactName === 'string'
      ? opportunity.pointOfContactName
      : null,
  amountMicros:
    typeof opportunity.amountMicros === 'number'
      ? opportunity.amountMicros
      : null,
  currencyCode:
    typeof opportunity.currencyCode === 'string' ? opportunity.currencyCode : null,
});

const normalizeLicense = (
  license: Record<string, unknown>,
): Record<string, unknown> => ({
  id: typeof license.id === 'string' ? license.id : '',
  name: typeof license.name === 'string' ? license.name : '',
  renewalRiskLevel:
    typeof license.renewalRiskLevel === 'string'
      ? license.renewalRiskLevel
      : null,
  expiryDate:
    typeof license.expiryDate === 'string' ? license.expiryDate : null,
  vendorName:
    typeof license.vendorName === 'string' ? license.vendorName : null,
  productName:
    typeof license.productName === 'string' ? license.productName : null,
  contractValueMicros:
    typeof license.contractValueMicros === 'number'
      ? license.contractValueMicros
      : null,
  currencyCode:
    typeof license.currencyCode === 'string' ? license.currencyCode : null,
});

const filterBySearch = <TRecord extends Record<string, unknown>>(
  records: TRecord[],
  query: string,
  getHaystacks: (record: TRecord) => Array<string | null | undefined>,
): TRecord[] =>
  records.filter((record) => matchesQuery(getHaystacks(record), query));

const getSearchQuery = (event: ToolRoutePayload): string =>
  toStringValue(toRecord(event.body), 'query');

const getActionRecord = (
  record: Record<string, unknown>,
): CrmActionRecord | null => {
  const action = toRecordValue(record.action);
  const kind = action
    ? toStringValue(action, 'kind') || toStringValue(record, 'kind')
    : toStringValue(record, 'kind');
  const operation = action
    ? toStringValue(action, 'operation') || toStringValue(record, 'operation')
    : toStringValue(record, 'operation');
  const data = action
    ? toRecordValue(action.data) ?? toRecordValue(record.data)
    : toRecordValue(record.data);
  const lookup = action
    ? toRecordValue(action.lookup) ?? toRecordValue(record.lookup)
    : toRecordValue(record.lookup);
  const targetId = action
    ? toStringValue(action, 'targetId') || toStringValue(record, 'targetId')
    : toStringValue(record, 'targetId');

  if (!isEntityKind(kind) || operation.length === 0) {
    return null;
  }

  return {
    kind,
    operation: operation as CrmActionRecord['operation'],
    data: data ?? {},
    ...(targetId.length > 0 ? { targetId } : {}),
    ...(lookup ? { lookup: Object.fromEntries(
      Object.entries(lookup).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string> } : {}),
  };
};

export const handleLoadSlackRequestRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const slackRequestId = getSlackRequestId(toRecord(event.body));

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  return {
    ok: true,
    slackRequest,
  };
};

export const handleLoadThreadContextRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const slackRequestId = getSlackRequestId(toRecord(event.body));

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  const threadContext =
    await loadOrCreateThreadContextForSlackRequest(slackRequest);

  return {
    ok: true,
    threadContext,
  };
};

export const handleGetToolCatalogRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  return {
    ok: true,
    toolCatalog: getToolCatalog(),
  };
};

export const handleSearchCompaniesRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const query = getSearchQuery(event);
  const companies = await fetchCompanies();
  const results = filterBySearch(companies, query, (company) => [
    company.name,
    company.accountSegment,
    company.businessUnit,
    company.companyStatus,
    company.domainName,
    company.linkedinLink,
  ]).map(normalizeCompany);

  return {
    ok: true,
    results,
  };
};

export const handleSearchPeopleRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const query = getSearchQuery(event);
  const people = await fetchPeople();
  const results = filterBySearch(people, query, (person) => [
    person.fullName,
    person.primaryEmail,
    person.jobTitle,
    person.companyName,
    person.contactRoleType,
    person.city,
    person.linkedinLink,
  ]).map(normalizePerson);

  return {
    ok: true,
    results,
  };
};

export const handleSearchOpportunitiesRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const query = getSearchQuery(event);
  const opportunities = await fetchOpportunities();
  const results = filterBySearch(opportunities, query, (opportunity) => [
    opportunity.name,
    opportunity.stage,
    opportunity.closeDate,
    opportunity.companyName,
    opportunity.pointOfContactName,
  ]).map(normalizeOpportunity);

  return {
    ok: true,
    results,
  };
};

export const handleSearchLicensesRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const query = getSearchQuery(event);
  const licenses = await fetchLicenses();
  const results = filterBySearch(licenses, query, (license) => [
    license.name,
    license.renewalRiskLevel,
    license.vendorName,
    license.productName,
    license.expiryDate,
    license.endCustomerCompanyName,
    license.solutionName,
  ]).map(normalizeLicense);

  return {
    ok: true,
    results,
  };
};

export const handleSearchActivitiesRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const query = getSearchQuery(event);
  const [notes, tasks] = await Promise.all([fetchNotes(), fetchTasks()]);

  return {
    ok: true,
    notes: filterBySearch(notes, query, (note) => [
      note.title,
      note.markdown,
    ]).map((note) => ({
      id: note.id,
      title: note.title,
      createdAt: note.createdAt ?? null,
      markdown: note.markdown ?? null,
    })),
    tasks: filterBySearch(tasks, query, (task) => [
      task.title,
      task.markdown,
      task.status,
    ]).map((task) => ({
      id: task.id,
      title: task.title,
      createdAt: task.createdAt ?? null,
      status: task.status ?? null,
      dueAt: task.dueAt ?? null,
      markdown: task.markdown ?? null,
    })),
  };
};

export const handleCreateRecordRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const action = getActionRecord({
    ...toRecord(event.body),
    operation: 'create',
  });

  if (!action || action.operation !== 'create') {
    return {
      ok: false,
      message: 'create action is required',
    };
  }

  const actionResult = await executeImmediateCreateAction(action);

  return {
    ok: true,
    actionResult,
  };
};

export const handlePreviewRecordActionRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const action = getActionRecord(toRecord(event.body));

  if (!action || (action.operation !== 'update' && action.operation !== 'delete')) {
    return {
      ok: false,
      message: 'update or delete action is required',
    };
  }

  const preview = await previewApprovalAction(action);

  return {
    ok: true,
    preview,
  };
};

export const handleUpdateRecordRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const action = getActionRecord({
    ...toRecord(event.body),
    operation: 'update',
  });

  if (!action) {
    return {
      ok: false,
      message: 'update action is required',
    };
  }

  const preview = await previewApprovalAction(action);

  return {
    ok: true,
    plannedAction: preview.action,
    matchedRecord: preview.matchedRecord,
    reviewItem: preview.reviewItem,
  };
};

export const handleDeleteRecordRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const action = getActionRecord({
    ...toRecord(event.body),
    operation: 'delete',
  });

  if (!action) {
    return {
      ok: false,
      message: 'delete action is required',
    };
  }

  const preview = await previewApprovalAction(action);

  return {
    ok: true,
    plannedAction: preview.action,
    matchedRecord: preview.matchedRecord,
    reviewItem: preview.reviewItem,
  };
};

export const handleSaveQueryAnswerRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const body = toRecord(event.body);
  const slackRequestId = getSlackRequestId(body);
  const reply = getReply(body);

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  if (!reply) {
    return {
      ok: false,
      message: 'reply is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  const resultJson = toRecord(body.resultJson);
  const threadContextPatch =
    getThreadContextPatch(body) ??
    buildFallbackQueryPatch({
      slackRequestId,
      reply,
    });
  const updated = await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'ANSWERED',
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
          threadContextPatch,
          aiDiagnostics: getDiagnosticsPatch(resultJson),
          reply,
          processingTrace: {
            stage: 'QUERY_ANSWER_SAVED',
            updatedAt: nowIso(),
          },
        },
      }),
      lastProcessedAt: nowIso(),
    },
  });

  await applyThreadContextPatchToSlackRequest({
    slackRequest,
    patch: threadContextPatch,
  });

  return {
    ok: true,
    slackRequestId: updated.id,
    processingStatus: updated.processingStatus,
  };
};

export const handleSaveExecutionReportRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const body = toRecord(event.body);
  const slackRequestId = getSlackRequestId(body);
  const reply = getReply(body);

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  if (!reply) {
    return {
      ok: false,
      message: 'reply is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  const resultJson = toRecord(body.resultJson);
  const threadContextPatch =
    getThreadContextPatch(body) ??
    buildFallbackAppliedPatch({
      reply,
      resultJson,
    });
  const updated = await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'APPLIED',
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
          threadContextPatch,
          aiDiagnostics: getDiagnosticsPatch(resultJson),
          reply,
          processingTrace: {
            stage: 'EXECUTION_REPORT_SAVED',
            updatedAt: nowIso(),
          },
        },
      }),
      lastProcessedAt: nowIso(),
    },
  });

  await applyThreadContextPatchToSlackRequest({
    slackRequest,
    patch: threadContextPatch,
  });

  return {
    ok: true,
    slackRequestId: updated.id,
    processingStatus: updated.processingStatus,
  };
};

export const handleSaveAppliedResultRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const body = toRecord(event.body);
  const slackRequestId = getSlackRequestId(body);
  const reply = getReply(body);

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  if (!reply) {
    return {
      ok: false,
      message: 'reply is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  const resultJson = toRecord(body.resultJson);
  const threadContextPatch =
    getThreadContextPatch(body) ??
    buildFallbackAppliedPatch({
      reply,
      resultJson,
    });
  const updated = await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'APPLIED',
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
          threadContextPatch,
          aiDiagnostics: getDiagnosticsPatch(resultJson),
          reply,
          processingTrace: {
            stage: 'APPLIED_RESULT_SAVED',
            updatedAt: nowIso(),
          },
        },
      }),
      lastProcessedAt: nowIso(),
    },
  });

  await applyThreadContextPatchToSlackRequest({
    slackRequest,
    patch: threadContextPatch,
  });

  return {
    ok: true,
    slackRequestId: updated.id,
    processingStatus: updated.processingStatus,
  };
};

export const handleSaveWriteDraftRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const body = toRecord(event.body);
  const slackRequestId = getSlackRequestId(body);
  const draft = toRecordValue(body.draft);

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  if (!draft) {
    return {
      ok: false,
      message: 'draft is required',
    };
  }

  const draftActions = Array.isArray(draft.actions) ? draft.actions : [];

  if (draftActions.length === 0) {
    return {
      ok: false,
      message: 'draft.actions must contain at least one approval action',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  const resultJson = toRecord(body.resultJson);
  const threadContextPatch =
    getThreadContextPatch(body) ??
    buildFallbackWriteDraftPatch({
      slackRequestId,
      draft,
    });
  const updated = await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'AWAITING_CONFIRMATION',
      draftJson: draft,
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
          threadContextPatch,
          aiDiagnostics: getDiagnosticsPatch(resultJson),
          processingTrace: {
            stage: 'WRITE_DRAFT_SAVED',
            updatedAt: nowIso(),
          },
        },
      }),
      lastProcessedAt: nowIso(),
    },
  });

  await applyThreadContextPatchToSlackRequest({
    slackRequest,
    patch: threadContextPatch,
  });

  await postSlackReplyForRequest({
    slackRequest,
    reply: buildApprovalReply({
      slackRequestId,
      draft: draft as CrmWriteDraft,
    }),
  });

  return {
    ok: true,
    slackRequestId: updated.id,
    processingStatus: updated.processingStatus,
  };
};

export const handleMarkRunnerErrorRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const body = toRecord(event.body);
  const slackRequestId = getSlackRequestId(body);
  const errorMessage =
    toStringValue(body, 'errorMessage') || toStringValue(body, 'message');

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  if (errorMessage.length === 0) {
    return {
      ok: false,
      message: 'errorMessage is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  const resultJson = toRecord(body.resultJson);
  const updated = await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'ERROR',
      errorMessage,
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
          aiDiagnostics: getDiagnosticsPatch(resultJson),
          processingTrace: {
            stage: 'RUNNER_ERROR',
            updatedAt: nowIso(),
            details: {
              errorMessage,
            },
          },
        },
      }),
      lastProcessedAt: nowIso(),
    },
  });

  return {
    ok: true,
    slackRequestId: updated.id,
    processingStatus: updated.processingStatus,
  };
};

export const handlePostSlackReplyRoute = async (
  event: ToolRoutePayload,
): Promise<Record<string, unknown>> => {
  if (!isAuthorized(event)) {
    return rejectToolRequest();
  }

  const body = toRecord(event.body);
  const slackRequestId = getSlackRequestId(body);
  const reply = getReply(body);

  if (slackRequestId.length === 0) {
    return {
      ok: false,
      message: 'slackRequestId is required',
    };
  }

  if (!reply) {
    return {
      ok: false,
      message: 'reply is required',
    };
  }

  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    return {
      ok: false,
      message: `Slack 요청 ${slackRequestId}를 찾지 못했습니다.`,
    };
  }

  await postSlackReplyForRequest({
    slackRequest,
    reply,
    replaceOriginal: toBooleanValue(body, 'replaceOriginal'),
  });

  return {
    ok: true,
    slackRequestId,
  };
};
