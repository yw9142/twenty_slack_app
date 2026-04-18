import type { RoutePayload } from 'twenty-sdk';

import { getToolSharedSecret } from 'src/utils/env';
import {
  fetchCompanies,
  fetchLicenses,
  fetchNotes,
  fetchOpportunities,
  fetchPeople,
  fetchTasks,
} from 'src/utils/crm-query';
import type { CrmWriteDraft, SlackReply } from 'src/types/slack-agent';
import { postSlackReplyForRequest } from 'src/utils/slack-api';
import {
  findSlackRequestById,
  updateSlackRequest,
} from 'src/utils/slack-intake-service';
import { buildApprovalReply } from 'src/utils/slack-orchestrator';
import { normalizeText } from 'src/utils/strings';

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
  const updated = await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'ANSWERED',
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
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
      processingStatus: 'AWAITING_CONFIRMATION',
      draftJson: draft,
      resultJson: mergeResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJson ?? {}),
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
