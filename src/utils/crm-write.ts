import type {
  ApplyDraftResult,
  BasicCompanyRecord,
  BasicOpportunityRecord,
  BasicPersonRecord,
  CrmActionRecord,
  CrmWriteDraft,
  DraftReviewItem,
  EntityKind,
  LeadPackageDraftResult,
  LeadPackagePayload,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import {
  fetchCompanies,
  fetchNotes,
  fetchOpportunities,
  fetchPeople,
  fetchTasks,
} from 'src/utils/crm-query';
import type { ObjectFieldMetadata } from 'src/utils/metadata-client';
import { fetchObjectFields } from 'src/utils/metadata-client';
import { toRichTextValue } from 'src/utils/rich-text';
import { normalizeText, splitFullName, toTitleCaseKey } from 'src/utils/strings';

type EntityConfig = {
  queryRoot: string;
  createMutation: string;
  deleteMutation: string;
  updateMutation: string;
  idField: string;
};

const ENTITY_CONFIG: Record<EntityKind, EntityConfig> = {
  company: {
    queryRoot: 'companies',
    createMutation: 'createCompany',
    deleteMutation: 'deleteCompany',
    updateMutation: 'updateCompany',
    idField: 'id',
  },
  person: {
    queryRoot: 'people',
    createMutation: 'createPerson',
    deleteMutation: 'deletePerson',
    updateMutation: 'updatePerson',
    idField: 'id',
  },
  opportunity: {
    queryRoot: 'opportunities',
    createMutation: 'createOpportunity',
    deleteMutation: 'deleteOpportunity',
    updateMutation: 'updateOpportunity',
    idField: 'id',
  },
  solution: {
    queryRoot: 'solutions',
    createMutation: 'createSolution',
    deleteMutation: 'deleteSolution',
    updateMutation: 'updateSolution',
    idField: 'id',
  },
  companyRelationship: {
    queryRoot: 'companyRelationships',
    createMutation: 'createCompanyRelationship',
    deleteMutation: 'deleteCompanyRelationship',
    updateMutation: 'updateCompanyRelationship',
    idField: 'id',
  },
  opportunityStakeholder: {
    queryRoot: 'opportunityStakeholders',
    createMutation: 'createOpportunityStakeholder',
    deleteMutation: 'deleteOpportunityStakeholder',
    updateMutation: 'updateOpportunityStakeholder',
    idField: 'id',
  },
  opportunitySolution: {
    queryRoot: 'opportunitySolutions',
    createMutation: 'createOpportunitySolution',
    deleteMutation: 'deleteOpportunitySolution',
    updateMutation: 'updateOpportunitySolution',
    idField: 'id',
  },
  note: {
    queryRoot: 'notes',
    createMutation: 'createNote',
    deleteMutation: 'deleteNote',
    updateMutation: 'updateNote',
    idField: 'id',
  },
  task: {
    queryRoot: 'tasks',
    createMutation: 'createTask',
    deleteMutation: 'deleteTask',
    updateMutation: 'updateTask',
    idField: 'id',
  },
};

const normalizeLookupValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const HELPER_LOOKUP_FIELDS = [
  'companyName',
  'pointOfContactName',
  'primaryVendorCompanyName',
  'primaryPartnerCompanyName',
  'opportunityName',
] as const;

const FALLBACK_WRITABLE_FIELDS: Partial<Record<EntityKind, string[]>> = {
  company: ['name', 'domainName', 'linkedinLink', 'employees', 'companyStatus'],
  person: ['name', 'companyId', 'jobTitle', 'emails', 'linkedinLink', 'city'],
  opportunity: ['name', 'companyId', 'pointOfContactId', 'stage', 'closeDate', 'amount'],
  note: ['title', 'bodyV2'],
  task: ['title', 'bodyV2', 'status', 'dueAt'],
};

const ACTION_PRIORITY: Record<EntityKind, number> = {
  company: 10,
  person: 20,
  solution: 25,
  opportunity: 30,
  companyRelationship: 40,
  opportunityStakeholder: 45,
  opportunitySolution: 50,
  note: 60,
  task: 70,
};

type ResolvedEntityMaps = {
  companyIdsByName: Map<string, string>;
  personIdsByKey: Map<string, string>;
  opportunityIdsByName: Map<string, string>;
};

type SelectOption = {
  label: string;
  value: string;
};

const writableFieldNamesByKind = new Map<EntityKind, Promise<Set<string>>>();
const writableFieldsByKind = new Map<EntityKind, Promise<ObjectFieldMetadata[]>>();

const SELECT_VALUE_ALIASES: Partial<
  Record<EntityKind, Partial<Record<string, Record<string, string[]>>>>
> = {
  company: {
    companyStatus: {
      ACTIVE: ['active', '활성'],
      DORMANT: ['dormant', '휴면'],
      INACTIVE: ['inactive', '비활성'],
    },
  },
  opportunity: {
    stage: {
      IDENTIFIED: ['lead', 'new lead', 'new', '리드', '신규 리드', '신규리드', '발굴'],
      QUALIFIED: ['qualified', 'qualification', '자격확인'],
      VENDOR_ALIGNED: ['vendor aligned', 'vendor_aligned', '벤더협의'],
      DISCOVERY_POC: ['discovery', 'poc', 'proposal', 'proposal/poc', '제안', '제안/poc'],
      QUOTED: ['quote', 'quoted', '견적'],
      NEGOTIATION: ['negotiation', 'negotiating', '협상'],
      CLOSED_WON: ['won', 'closed won', '수주'],
      CLOSED_LOST: ['lost', 'closed lost', '실주'],
      ON_HOLD: ['hold', 'on hold', '보류'],
    },
  },
};

const toNormalizedKey = (value: string | null | undefined): string =>
  normalizeText(value);

const toPersonLookupKey = ({
  name,
  companyName,
}: {
  name: string | null | undefined;
  companyName?: string | null | undefined;
}): string => `${toNormalizedKey(name)}::${toNormalizedKey(companyName)}`;

const toSelectOptions = (value: unknown): SelectOption[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((option) => {
    if (!option || typeof option !== 'object') {
      return [];
    }

    const label = normalizeLookupValue((option as Record<string, unknown>).label);
    const rawValue = normalizeLookupValue((option as Record<string, unknown>).value);

    if (!label || !rawValue) {
      return [];
    }

    return [
      {
        label,
        value: rawValue,
      },
    ];
  });
};

const getWritableFields = async (kind: EntityKind): Promise<ObjectFieldMetadata[]> => {
  const cached = writableFieldsByKind.get(kind);

  if (cached) {
    return cached;
  }

  const loader = (async () => {
    try {
      return await fetchObjectFields(kind);
    } catch {
      return [];
    }
  })();

  writableFieldsByKind.set(kind, loader);

  return loader;
};

const getWritableFieldNames = async (kind: EntityKind): Promise<Set<string>> => {
  const cached = writableFieldNamesByKind.get(kind);

  if (cached) {
    return cached;
  }

  const loader = (async () => {
    const fields = await getWritableFields(kind);

    if (fields.length > 0) {
      return new Set(
        fields.flatMap((field) =>
          field.relation
            ? [field.name, `${field.name}Id`]
            : [field.name],
        ),
      );
    }

    return new Set(FALLBACK_WRITABLE_FIELDS[kind] ?? []);
  })();

  writableFieldNamesByKind.set(kind, loader);

  return loader;
};

const normalizeSelectFieldValue = async ({
  kind,
  fieldName,
  value,
}: {
  kind: EntityKind;
  fieldName: string;
  value: string;
}): Promise<string | null> => {
  const fields = await getWritableFields(kind);
  const field = fields.find((candidate) => candidate.name === fieldName);

  if (!field || field.type !== 'SELECT') {
    return value;
  }

  const options = toSelectOptions(field.options);

  if (options.length === 0) {
    return value;
  }

  const normalizedValue = toNormalizedKey(value);
  const directMatch = options.find(
    (option) =>
      toNormalizedKey(option.value) === normalizedValue ||
      toNormalizedKey(option.label) === normalizedValue,
  );

  if (directMatch) {
    return directMatch.value;
  }

  const aliasOptions = SELECT_VALUE_ALIASES[kind]?.[fieldName];

  if (!aliasOptions) {
    return null;
  }

  const aliasMatch = options.find((option) =>
    (aliasOptions[option.value] ?? []).some(
      (alias) => toNormalizedKey(alias) === normalizedValue,
    ),
  );

  return aliasMatch?.value ?? null;
};

const lookupCompanyIdByName = async (name: string): Promise<string | null> => {
  const companies = await fetchCompanies();
  const match = companies.find(
    (company) => normalizeText(company.name) === normalizeText(name),
  );

  return match?.id ?? null;
};

const lookupPersonByReference = async ({
  email,
  fullName,
  companyName,
}: {
  email?: string;
  fullName?: string;
  companyName?: string;
}): Promise<BasicPersonRecord | null> => {
  const people = await fetchPeople();

  if (email) {
    const match = people.find(
      (person) => normalizeText(person.primaryEmail) === normalizeText(email),
    );

    if (match) {
      return match;
    }
  }

  if (fullName) {
    const match = people.find(
      (person) =>
        normalizeText(person.fullName) === normalizeText(fullName) &&
        (!companyName ||
          normalizeText(person.companyName) === normalizeText(companyName)),
    );

    if (match) {
      return match;
    }
  }

  return null;
};

const lookupOpportunityByName = async (
  name: string,
): Promise<BasicOpportunityRecord | null> => {
  const opportunities = await fetchOpportunities();
  const match = opportunities.find(
    (opportunity) => normalizeText(opportunity.name) === normalizeText(name),
  );

  return match ?? null;
};

const hydrateCommonReferenceIds = async (
  data: Record<string, unknown>,
  resolved?: ResolvedEntityMaps,
): Promise<Record<string, unknown>> => {
  const nextData = { ...data };

  if (typeof nextData.companyName === 'string' && !nextData.companyId) {
    nextData.companyId =
      resolved?.companyIdsByName.get(toNormalizedKey(nextData.companyName)) ??
      (await lookupCompanyIdByName(nextData.companyName));
  }

  if (typeof nextData.pointOfContactName === 'string' && !nextData.pointOfContactId) {
    const companyName =
      typeof nextData.companyName === 'string' ? nextData.companyName : undefined;

    nextData.pointOfContactId =
      resolved?.personIdsByKey.get(
        toPersonLookupKey({
          name: nextData.pointOfContactName,
          companyName,
        }),
      ) ??
      resolved?.personIdsByKey.get(
        toPersonLookupKey({
          name: nextData.pointOfContactName,
        }),
      ) ??
      (await lookupPersonByReference({
        fullName: nextData.pointOfContactName,
        companyName,
      }))?.id ??
      null;
  }

  return nextData;
};

const normalizeEntityData = async (
  kind: EntityKind,
  data: Record<string, unknown>,
  resolved?: ResolvedEntityMaps,
): Promise<Record<string, unknown>> => {
  const aliasNormalizedData = { ...data };

  if (
    kind === 'company' &&
    typeof aliasNormalizedData.status === 'string' &&
    !aliasNormalizedData.companyStatus
  ) {
    aliasNormalizedData.companyStatus = aliasNormalizedData.status;
  }

  if (
    typeof aliasNormalizedData.contactName === 'string' &&
    !aliasNormalizedData.pointOfContactName
  ) {
    aliasNormalizedData.pointOfContactName = aliasNormalizedData.contactName;
  }

  delete aliasNormalizedData.contactName;

  const nextData = await hydrateCommonReferenceIds(aliasNormalizedData, resolved);

  for (const field of HELPER_LOOKUP_FIELDS) {
    delete nextData[field];
  }

  if (kind === 'person') {
    const nameValue = normalizeLookupValue(nextData.name);

    if (nameValue) {
      const { firstName, lastName } = splitFullName(nameValue);
      nextData.name = { firstName, lastName };
    }

    if (typeof nextData.primaryEmail === 'string' && !nextData.emails) {
      nextData.emails = {
        primaryEmail: nextData.primaryEmail,
        additionalEmails: [],
      };
      delete nextData.primaryEmail;
    }

    if (typeof nextData.linkedinLink === 'string') {
      nextData.linkedinLink = {
        primaryLinkUrl: nextData.linkedinLink,
      };
    }
  }

  if (kind === 'company') {
    if (typeof nextData.domainName === 'string') {
      nextData.domainName = {
        primaryLinkUrl: nextData.domainName,
      };
    }

    if (typeof nextData.linkedinLink === 'string') {
      nextData.linkedinLink = {
        primaryLinkUrl: nextData.linkedinLink,
      };
    }

    if (typeof nextData.companyStatus === 'string') {
      const companyStatus = await normalizeSelectFieldValue({
        kind,
        fieldName: 'companyStatus',
        value: nextData.companyStatus,
      });

      if (companyStatus) {
        nextData.companyStatus = companyStatus;
      } else {
        delete nextData.companyStatus;
      }
    }
  }

  if (kind === 'note' && typeof nextData.body === 'string' && !nextData.bodyV2) {
    nextData.bodyV2 = toRichTextValue(nextData.body);
    delete nextData.body;
  }

  if (kind === 'task' && typeof nextData.body === 'string' && !nextData.bodyV2) {
    nextData.bodyV2 = toRichTextValue(nextData.body);
    delete nextData.body;
  }

  if (kind === 'note' || kind === 'task') {
    delete nextData.companyId;
    delete nextData.pointOfContactId;
    delete nextData.opportunityId;
  }

  if (
    kind === 'opportunity' &&
    typeof nextData.amount === 'number' &&
    !nextData.amountMicros
  ) {
    nextData.amount = {
      amountMicros: nextData.amount * 1_000_000,
      currencyCode:
        typeof nextData.currencyCode === 'string' ? nextData.currencyCode : 'KRW',
    };
    delete nextData.currencyCode;
  }

  if (kind === 'opportunity' && typeof nextData.stage === 'string') {
    const stage = await normalizeSelectFieldValue({
      kind,
      fieldName: 'stage',
      value: nextData.stage,
    });

    if (stage) {
      nextData.stage = stage;
    } else {
      delete nextData.stage;
    }
  }

  const writableFieldNames = await getWritableFieldNames(kind);

  if (writableFieldNames.size === 0) {
    return nextData;
  }

  return Object.fromEntries(
    Object.entries(nextData).filter(([fieldName]) =>
      writableFieldNames.has(fieldName),
    ),
  );

};

const findRecordIdByLookup = async (
  action: CrmActionRecord,
): Promise<string | null> => {
  if (!action.lookup) {
    return normalizeLookupValue(action.targetId) ?? null;
  }

  const explicitTargetId = normalizeLookupValue(action.targetId);

  if (explicitTargetId) {
    return explicitTargetId;
  }

  const explicitId = normalizeLookupValue(action.lookup.id);

  if (explicitId) {
    return explicitId;
  }

  if (action.kind === 'company') {
    const name = normalizeLookupValue(action.lookup.name);

    return name ? lookupCompanyIdByName(name) : null;
  }

  if (action.kind === 'person') {
    const person = await lookupPersonByReference({
      email: normalizeLookupValue(action.lookup.primaryEmail) ?? undefined,
      fullName: normalizeLookupValue(action.lookup.name) ?? undefined,
      companyName: normalizeLookupValue(action.lookup.companyName) ?? undefined,
    });

    return person?.id ?? null;
  }

  if (action.kind === 'opportunity') {
    const name = normalizeLookupValue(action.lookup.name);
    const opportunity = name ? await lookupOpportunityByName(name) : null;

    return opportunity?.id ?? null;
  }

  return null;
};

const createRecord = async ({
  kind,
  data,
  resolved,
}: {
  kind: EntityKind;
  data: Record<string, unknown>;
  resolved?: ResolvedEntityMaps;
}): Promise<string> => {
  const client = createCoreClient();
  const config = ENTITY_CONFIG[kind];
  const normalizedData = await normalizeEntityData(kind, data, resolved);
  const mutationName = config.createMutation;
  const response = await client.mutation<Record<string, unknown>>({
    [mutationName]: {
      __args: {
        data: normalizedData,
      },
      id: true,
    },
  });

  const created = response[mutationName];

  if (
    !created ||
    typeof created !== 'object' ||
    !('id' in created) ||
    typeof created.id !== 'string'
  ) {
    throw new Error(`Failed to create ${kind}`);
  }

  return created.id;
};

const updateRecord = async ({
  kind,
  id,
  data,
  resolved,
}: {
  kind: EntityKind;
  id: string;
  data: Record<string, unknown>;
  resolved?: ResolvedEntityMaps;
}): Promise<string> => {
  const client = createCoreClient();
  const config = ENTITY_CONFIG[kind];
  const normalizedData = await normalizeEntityData(kind, data, resolved);
  const mutationName = config.updateMutation;
  const response = await client.mutation<Record<string, unknown>>({
    [mutationName]: {
      __args: {
        id,
        data: normalizedData,
      },
      id: true,
    },
  });

  const updated = response[mutationName];

  if (
    !updated ||
    typeof updated !== 'object' ||
    !('id' in updated) ||
    typeof updated.id !== 'string'
  ) {
    throw new Error(`Failed to update ${kind} ${id}`);
  }

  return updated.id;
};

const deleteRecord = async ({
  kind,
  id,
}: {
  kind: EntityKind;
  id: string;
}): Promise<string> => {
  const client = createCoreClient();
  const config = ENTITY_CONFIG[kind];
  const mutationName = config.deleteMutation;
  const response = await client.mutation<Record<string, unknown>>({
    [mutationName]: {
      __args: {
        id,
      },
      id: true,
    },
  });

  const deleted = response[mutationName];

  if (
    !deleted ||
    typeof deleted !== 'object' ||
    !('id' in deleted) ||
    typeof deleted.id !== 'string'
  ) {
    throw new Error(`Failed to delete ${kind} ${id}`);
  }

  return deleted.id;
};

const createResolvedEntityMaps = (): ResolvedEntityMaps => ({
  companyIdsByName: new Map<string, string>(),
  personIdsByKey: new Map<string, string>(),
  opportunityIdsByName: new Map<string, string>(),
});

const buildReviewFields = (
  data: Record<string, unknown>,
): DraftReviewItem['fields'] =>
  Object.entries(data)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .slice(0, 6)
    .map(([key, value]) => ({
      key,
      value: String(value),
    }));

const buildLeadPackageOpportunityName = ({
  companyName,
  solutionName,
  vendorName,
}: {
  companyName: string;
  solutionName?: string;
  vendorName?: string;
}): string => {
  const subject = normalizeLookupValue(solutionName) ?? normalizeLookupValue(vendorName);

  return subject
    ? `${companyName} ${subject} 신규 리드`
    : `${companyName} 신규 리드`;
};

const toQuarterEndDate = (year: string, quarter: string): string => {
  const quarterNumber = Number(quarter);

  if (quarterNumber === 1) {
    return `${year}-03-31`;
  }

  if (quarterNumber === 2) {
    return `${year}-06-30`;
  }

  if (quarterNumber === 3) {
    return `${year}-09-30`;
  }

  return `${year}-12-31`;
};

const parseLeadCloseDate = (value: string | undefined): string | null => {
  const normalizedValue = normalizeLookupValue(value);

  if (!normalizedValue) {
    return null;
  }

  const dateMatch = normalizedValue.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }

  const quarterMatch = normalizedValue.match(/(\d{4})\s*년?\s*([1-4])\s*분기/);

  if (quarterMatch) {
    return toQuarterEndDate(quarterMatch[1], quarterMatch[2]);
  }

  return null;
};

const parseLeadBudgetAmount = ({
  budgetAmount,
  budgetText,
}: Pick<LeadPackagePayload, 'budgetAmount' | 'budgetText'>): number | null => {
  if (typeof budgetAmount === 'number' && Number.isFinite(budgetAmount)) {
    return budgetAmount;
  }

  const normalizedBudgetText = normalizeLookupValue(budgetText);

  if (!normalizedBudgetText) {
    return null;
  }

  const eokMatch = normalizedBudgetText.match(/(\d+(?:\.\d+)?)\s*억/);

  if (eokMatch) {
    return Math.round(Number(eokMatch[1]) * 100_000_000);
  }

  const manMatch = normalizedBudgetText.match(/(\d+(?:\.\d+)?)\s*만/);

  if (manMatch) {
    return Math.round(Number(manMatch[1]) * 10_000);
  }

  return null;
};

const buildLeadPackageNoteBody = (
  payload: LeadPackagePayload,
): string =>
  [
    `고객사: ${payload.companyName}`,
    normalizeLookupValue(payload.contactName)
      ? `담당자: ${payload.contactName}`
      : null,
    normalizeLookupValue(payload.jobTitle) ? `직책: ${payload.jobTitle}` : null,
    normalizeLookupValue(payload.primaryEmail)
      ? `이메일: ${payload.primaryEmail}`
      : null,
    normalizeLookupValue(payload.phone) ? `연락처: ${payload.phone}` : null,
    normalizeLookupValue(payload.solutionName) || normalizeLookupValue(payload.vendorName)
      ? `관심 솔루션/벤더: ${normalizeLookupValue(payload.solutionName) ?? '미상'} / ${normalizeLookupValue(payload.vendorName) ?? '미상'}`
      : null,
    normalizeLookupValue(payload.currentSituation)
      ? `현재 상황: ${payload.currentSituation}`
      : null,
    normalizeLookupValue(payload.expectedScale)
      ? `예상 규모: ${payload.expectedScale}`
      : null,
    normalizeLookupValue(payload.budgetText) ? `예산: ${payload.budgetText}` : null,
    normalizeLookupValue(payload.targetQuarterOrDate)
      ? `도입 희망 시점: ${payload.targetQuarterOrDate}`
      : null,
    normalizeLookupValue(payload.sourceChannel)
      ? `유입 경로: ${payload.sourceChannel}`
      : null,
    normalizeLookupValue(payload.nextAction)
      ? `다음 액션: ${payload.nextAction}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

const buildLeadReviewItem = ({
  kind,
  decision,
  target,
  matchedRecord,
  reason,
  fields,
}: {
  kind: DraftReviewItem['kind'];
  decision: DraftReviewItem['decision'];
  target: string;
  matchedRecord?: string | null;
  reason?: string | null;
  fields: DraftReviewItem['fields'];
}): DraftReviewItem => ({
  kind,
  decision,
  target,
  matchedRecord: matchedRecord ?? null,
  reason: reason ?? null,
  fields,
});

const findMatchedRecordLabel = async ({
  action,
  recordId,
}: {
  action: CrmActionRecord;
  recordId: string;
}): Promise<string | null> => {
  if (action.kind === 'company') {
    const companies = await fetchCompanies();

    return (
      companies.find((company) => company.id === recordId)?.name ??
      normalizeLookupValue(action.lookup?.name)
    );
  }

  if (action.kind === 'person') {
    const people = await fetchPeople();

    return (
      people.find((person) => person.id === recordId)?.fullName ??
      normalizeLookupValue(action.lookup?.name)
    );
  }

  if (action.kind === 'opportunity') {
    const opportunities = await fetchOpportunities();

    return (
      opportunities.find((opportunity) => opportunity.id === recordId)?.name ??
      normalizeLookupValue(action.lookup?.name)
    );
  }

  if (action.kind === 'note') {
    const notes = await fetchNotes();

    return (
      notes.find((note) => note.id === recordId)?.title ??
      normalizeLookupValue(action.lookup?.title) ??
      normalizeLookupValue(action.lookup?.name)
    );
  }

  if (action.kind === 'task') {
    const tasks = await fetchTasks();

    return (
      tasks.find((task) => task.id === recordId)?.title ??
      normalizeLookupValue(action.lookup?.title) ??
      normalizeLookupValue(action.lookup?.name)
    );
  }

  return normalizeLookupValue(action.lookup?.name) ?? recordId;
};

const rememberResolvedRecord = ({
  resolved,
  action,
  id,
}: {
  resolved: ResolvedEntityMaps;
  action: CrmActionRecord;
  id: string;
}): void => {
  if (action.kind === 'company') {
    const companyName = normalizeLookupValue(
      typeof action.data.name === 'string' ? action.data.name : action.lookup?.name,
    );

    if (companyName) {
      resolved.companyIdsByName.set(toNormalizedKey(companyName), id);
    }

    return;
  }

  if (action.kind === 'person') {
    const personName = normalizeLookupValue(
      typeof action.data.name === 'string' ? action.data.name : action.lookup?.name,
    );
    const companyName = normalizeLookupValue(
      typeof action.data.companyName === 'string'
        ? action.data.companyName
        : action.lookup?.companyName,
    );

    if (personName) {
      resolved.personIdsByKey.set(
        toPersonLookupKey({ name: personName, companyName }),
        id,
      );
      resolved.personIdsByKey.set(toPersonLookupKey({ name: personName }), id);
    }

    return;
  }

  if (action.kind === 'opportunity') {
    const opportunityName = normalizeLookupValue(
      typeof action.data.name === 'string' ? action.data.name : action.lookup?.name,
    );

    if (opportunityName) {
      resolved.opportunityIdsByName.set(toNormalizedKey(opportunityName), id);
    }
  }
};

const resolveCompanyId = async ({
  resolved,
  data,
}: {
  resolved: ResolvedEntityMaps;
  data: Record<string, unknown>;
}): Promise<string | null> => {
  if (typeof data.companyId === 'string' && data.companyId.length > 0) {
    return data.companyId;
  }

  const companyName = normalizeLookupValue(data.companyName);

  if (!companyName) {
    return null;
  }

  return (
    resolved.companyIdsByName.get(toNormalizedKey(companyName)) ??
    (await lookupCompanyIdByName(companyName))
  );
};

const resolvePersonId = async ({
  resolved,
  data,
}: {
  resolved: ResolvedEntityMaps;
  data: Record<string, unknown>;
}): Promise<string | null> => {
  if (typeof data.pointOfContactId === 'string' && data.pointOfContactId.length > 0) {
    return data.pointOfContactId;
  }

  const personName = normalizeLookupValue(data.pointOfContactName);

  if (!personName) {
    return null;
  }

  const companyName = normalizeLookupValue(data.companyName);

  return (
    resolved.personIdsByKey.get(
      toPersonLookupKey({
        name: personName,
        companyName,
      }),
    ) ??
    resolved.personIdsByKey.get(
      toPersonLookupKey({
        name: personName,
      }),
    ) ??
    (await lookupPersonByReference({
      fullName: personName,
      companyName: companyName ?? undefined,
    }))?.id ??
    null
  );
};

const resolveOpportunityId = async ({
  resolved,
  data,
}: {
  resolved: ResolvedEntityMaps;
  data: Record<string, unknown>;
}): Promise<string | null> => {
  if (typeof data.opportunityId === 'string' && data.opportunityId.length > 0) {
    return data.opportunityId;
  }

  const opportunityName = normalizeLookupValue(data.opportunityName);

  if (!opportunityName) {
    return null;
  }

  return (
    resolved.opportunityIdsByName.get(toNormalizedKey(opportunityName)) ??
    (await lookupOpportunityByName(opportunityName))?.id ??
    null
  );
};

const createTargetLink = async ({
  mutationName,
  data,
}: {
  mutationName: 'createNoteTarget' | 'createTaskTarget';
  data: Record<string, unknown>;
}): Promise<void> => {
  const client = createCoreClient();

  await client.mutation({
    [mutationName]: {
      __args: {
        data,
      },
      id: true,
    },
  });
};

const createSupportingTargets = async ({
  kind,
  recordId,
  data,
  resolved,
}: {
  kind: 'note' | 'task';
  recordId: string;
  data: Record<string, unknown>;
  resolved: ResolvedEntityMaps;
}): Promise<void> => {
  const companyId = await resolveCompanyId({
    resolved,
    data,
  });
  const personId = await resolvePersonId({
    resolved,
    data,
  });
  const opportunityId = await resolveOpportunityId({
    resolved,
    data,
  });
  const mutationName = kind === 'note' ? 'createNoteTarget' : 'createTaskTarget';
  const idField = kind === 'note' ? 'noteId' : 'taskId';
  const targetPayloads: Record<string, unknown>[] = [];

  if (companyId) {
    targetPayloads.push({
      [idField]: recordId,
      targetCompanyId: companyId,
    });
  }

  if (personId) {
    targetPayloads.push({
      [idField]: recordId,
      targetPersonId: personId,
    });
  }

  if (opportunityId) {
    targetPayloads.push({
      [idField]: recordId,
      targetOpportunityId: opportunityId,
    });
  }

  for (const payload of targetPayloads) {
    await createTargetLink({
      mutationName,
      data: payload,
    });
  }
};

export const executeImmediateCreateAction = async (
  action: CrmActionRecord,
): Promise<{ kind: EntityKind; operation: 'create'; id: string }> => {
  if (action.operation !== 'create') {
    throw new Error('Immediate create actions only support operation=create');
  }

  const resolved = createResolvedEntityMaps();
  const id = await createRecord({
    kind: action.kind,
    data: action.data,
    resolved,
  });

  rememberResolvedRecord({
    resolved,
    action,
    id,
  });

  if (action.kind === 'note' || action.kind === 'task') {
    await createSupportingTargets({
      kind: action.kind,
      recordId: id,
      data: action.data,
      resolved,
    });
  }

  return {
    kind: action.kind,
    operation: 'create',
    id,
  };
};

export const previewApprovalAction = async (
  action: CrmActionRecord,
): Promise<{
  action: CrmActionRecord;
  matchedRecord: { id: string; label: string | null } | null;
  reviewItem: DraftReviewItem;
}> => {
  if (action.operation !== 'update' && action.operation !== 'delete') {
    throw new Error('Approval previews only support update or delete actions');
  }

  const recordId = await findRecordIdByLookup(action);
  const matchedLabel = recordId
    ? await findMatchedRecordLabel({
        action,
        recordId,
      })
    : null;
  const normalizedLookup = {
    ...(action.lookup ?? {}),
    ...(recordId ? { id: recordId } : {}),
  };
  const normalizedAction: CrmActionRecord = {
    ...action,
    lookup: Object.keys(normalizedLookup).length > 0 ? normalizedLookup : undefined,
    data: action.data ?? {},
  };

  return {
    action: normalizedAction,
    matchedRecord: recordId
      ? {
          id: recordId,
          label: matchedLabel,
        }
      : null,
    reviewItem: {
      kind: action.kind,
      decision: recordId
        ? action.operation === 'delete'
          ? 'DELETE'
          : 'UPDATE'
        : 'SKIP',
      target:
        matchedLabel ??
        normalizeLookupValue(action.lookup?.name) ??
        normalizeLookupValue(action.lookup?.title) ??
        recordId ??
        action.kind,
      matchedRecord: matchedLabel,
      reason: recordId
        ? action.operation === 'delete'
          ? '승인 후 실제 삭제가 실행됩니다.'
          : null
        : '기존 레코드를 찾지 못해 승인 시 반영이 건너뛸 수 있습니다.',
      fields: action.operation === 'delete' ? [] : buildReviewFields(action.data ?? {}),
    },
  };
};

export const buildLeadPackageDraft = async (
  payload: LeadPackagePayload,
): Promise<LeadPackageDraftResult> => {
  const companyName = normalizeLookupValue(payload.companyName);
  const contactName = normalizeLookupValue(payload.contactName);
  const primaryEmail = normalizeLookupValue(payload.primaryEmail);

  if (!companyName) {
    throw new Error('companyName is required for lead package drafts');
  }

  const company = await lookupCompanyByName(companyName);
  const person =
    contactName || primaryEmail
      ? await lookupPersonByReference({
          email: primaryEmail ?? undefined,
          fullName: contactName ?? undefined,
          companyName,
        })
      : null;
  const contactLabel = contactName ?? person?.fullName ?? null;
  const opportunityName = buildLeadPackageOpportunityName({
    companyName,
    solutionName: payload.solutionName,
    vendorName: payload.vendorName,
  });
  const noteTitle = `${companyName} 신규 리드 메모`;
  const taskTitle = `${companyName} 후속 제안 준비`;
  const closeDate = parseLeadCloseDate(payload.targetQuarterOrDate);
  const budgetAmount = parseLeadBudgetAmount(payload);
  const actions: CrmActionRecord[] = [];
  const reviewItems: DraftReviewItem[] = [];

  if (!company) {
    actions.push({
      kind: 'company',
      operation: 'create',
      data: {
        name: companyName,
      },
    });
    reviewItems.push(
      buildLeadReviewItem({
        kind: 'company',
        decision: 'CREATE',
        target: companyName,
        fields: [
          {
            key: 'name',
            value: companyName,
          },
        ],
      }),
    );
  } else {
    reviewItems.push(
      buildLeadReviewItem({
        kind: 'company',
        decision: 'SKIP',
        target: companyName,
        matchedRecord: company.name ?? companyName,
        reason: '기존 회사 레코드를 재사용합니다.',
        fields: [],
      }),
    );
  }

  if (contactName || primaryEmail) {
    if (!person) {
      actions.push({
        kind: 'person',
        operation: 'create',
        data: {
          ...(contactName ? { name: contactName } : {}),
          companyName,
          ...(normalizeLookupValue(payload.jobTitle)
            ? { jobTitle: payload.jobTitle }
            : {}),
          ...(primaryEmail ? { primaryEmail } : {}),
        },
      });
      reviewItems.push(
        buildLeadReviewItem({
          kind: 'person',
          decision: 'CREATE',
          target: contactName ?? primaryEmail ?? '담당자',
          fields: buildReviewFields({
            ...(contactName ? { name: contactName } : {}),
            ...(normalizeLookupValue(payload.jobTitle)
              ? { jobTitle: payload.jobTitle }
              : {}),
            ...(primaryEmail ? { primaryEmail } : {}),
          }),
        }),
      );
    } else {
      reviewItems.push(
        buildLeadReviewItem({
          kind: 'person',
          decision: 'SKIP',
          target: contactLabel ?? primaryEmail ?? person.fullName,
          matchedRecord: person.fullName,
          reason: '기존 담당자 레코드를 재사용합니다.',
          fields: [],
        }),
      );
    }
  }

  actions.push({
    kind: 'opportunity',
    operation: 'create',
    data: {
      name: opportunityName,
      companyName,
      ...(contactLabel ? { pointOfContactName: contactLabel } : {}),
      stage: 'IDENTIFIED',
      ...(budgetAmount ? { amount: budgetAmount } : {}),
      ...(closeDate ? { closeDate } : {}),
    },
  });
  reviewItems.push(
    buildLeadReviewItem({
      kind: 'opportunity',
      decision: 'CREATE',
      target: opportunityName,
      fields: buildReviewFields({
        name: opportunityName,
        stage: 'IDENTIFIED',
        ...(budgetAmount ? { amount: budgetAmount } : {}),
        ...(closeDate ? { closeDate } : {}),
      }),
    }),
  );

  actions.push({
    kind: 'note',
    operation: 'create',
    data: {
      title: noteTitle,
      body: buildLeadPackageNoteBody(payload),
      companyName,
      ...(contactLabel ? { pointOfContactName: contactLabel } : {}),
      opportunityName,
    },
  });
  reviewItems.push(
    buildLeadReviewItem({
      kind: 'note',
      decision: 'CREATE',
      target: noteTitle,
      fields: buildReviewFields({
        title: noteTitle,
      }),
    }),
  );

  if (normalizeLookupValue(payload.nextAction)) {
    actions.push({
      kind: 'task',
      operation: 'create',
      data: {
        title: taskTitle,
        body: payload.nextAction,
        companyName,
        ...(contactLabel ? { pointOfContactName: contactLabel } : {}),
        opportunityName,
      },
    });
    reviewItems.push(
      buildLeadReviewItem({
        kind: 'task',
        decision: 'CREATE',
        target: taskTitle,
        fields: buildReviewFields({
          title: taskTitle,
          body: payload.nextAction,
        }),
      }),
    );
  }

  return {
    draft: {
      summary: `${companyName} 신규 리드 등록 초안`,
      confidence: 0.93,
      sourceText: payload.sourceText,
      actions,
      warnings: [],
      review: {
        overview: `${companyName} 신규 리드 패키지 승인 초안`,
        opinion:
          '회사와 담당자 중복 여부를 확인한 뒤 승인하세요. 신규 등록은 승인 후에만 실행됩니다.',
        items: reviewItems,
      },
    },
    plannedRecords: {
      company: {
        decision: company ? 'REUSE' : 'CREATE',
        label: companyName,
        matchedRecord: company
          ? {
              id: company.id,
              label: company.name ?? companyName,
            }
          : null,
      },
      ...(contactName || primaryEmail
        ? {
            person: {
              decision: person ? 'REUSE' : 'CREATE',
              label: contactLabel ?? primaryEmail ?? '담당자',
              matchedRecord: person
                ? {
                    id: person.id,
                    label: person.fullName,
                  }
                : null,
            },
          }
        : {}),
      opportunity: {
        decision: 'CREATE',
        label: opportunityName,
        matchedRecord: null,
      },
      note: {
        decision: 'CREATE',
        label: noteTitle,
        matchedRecord: null,
      },
      ...(normalizeLookupValue(payload.nextAction)
        ? {
            task: {
              decision: 'CREATE',
              label: taskTitle,
              matchedRecord: null,
            },
          }
        : {}),
    },
  };
};

export const createOperationalTask = async ({
  title,
  body,
}: {
  title: string;
  body: string;
}): Promise<string> =>
  createRecord({
    kind: 'task',
    data: {
      title,
      status: 'TODO',
      bodyV2: toRichTextValue(body),
    },
  });

export const applyApprovedDraft = async (
  draft: CrmWriteDraft,
): Promise<ApplyDraftResult> => {
  const result: ApplyDraftResult = {
    created: [],
    deleted: [],
    updated: [],
    skipped: [],
    errors: [],
  };
  const resolved = createResolvedEntityMaps();
  const orderedActions = [...draft.actions].sort(
    (left, right) => ACTION_PRIORITY[left.kind] - ACTION_PRIORITY[right.kind],
  );

  for (const action of orderedActions) {
    try {
      if (action.operation === 'delete') {
        const recordId = await findRecordIdByLookup(action);

        if (!recordId) {
          result.skipped.push(
            `${action.kind} delete skipped because no existing record matched the lookup.`,
          );
          continue;
        }

        const id = await deleteRecord({
          kind: action.kind,
          id: recordId,
        });

        result.deleted.push({
          kind: action.kind,
          id,
        });
        continue;
      }

      if (action.operation === 'update') {
        const recordId = await findRecordIdByLookup(action);

        if (!recordId) {
          result.skipped.push(
            `${action.kind} update skipped because no existing record matched the lookup.`,
          );
          continue;
        }

        const id = await updateRecord({
          kind: action.kind,
          id: recordId,
          data: action.data,
          resolved,
        });

        result.updated.push({
          kind: action.kind,
          id,
        });

        rememberResolvedRecord({
          resolved,
          action,
          id,
        });

        if (action.kind === 'note' || action.kind === 'task') {
          await createSupportingTargets({
            kind: action.kind,
            recordId: id,
            data: action.data,
            resolved,
          });
        }
        continue;
      }

      if (action.lookup) {
        const existingId = await findRecordIdByLookup(action);

        if (existingId) {
          const id = await updateRecord({
            kind: action.kind,
            id: existingId,
            data: action.data,
            resolved,
          });

          result.updated.push({
            kind: action.kind,
            id,
          });

          rememberResolvedRecord({
            resolved,
            action,
            id,
          });

          if (action.kind === 'note' || action.kind === 'task') {
            await createSupportingTargets({
              kind: action.kind,
              recordId: id,
              data: action.data,
              resolved,
            });
          }
          continue;
        }
      }

      const id = await createRecord({
        kind: action.kind,
        data: action.data,
        resolved,
      });

      result.created.push({
        kind: action.kind,
        id,
      });

      rememberResolvedRecord({
        resolved,
        action,
        id,
      });

      if (action.kind === 'note' || action.kind === 'task') {
        await createSupportingTargets({
          kind: action.kind,
          recordId: id,
          data: action.data,
          resolved,
        });
      }
    } catch (error) {
      result.errors.push(
        `${action.kind} ${action.operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return result;
};

export const summarizeApplyResult = (result: ApplyDraftResult): string => {
  const createdCount = result.created.length;
  const deletedCount = result.deleted.length;
  const updatedCount = result.updated.length;
  const skippedCount = result.skipped.length;
  const errorCount = result.errors.length;

  return [
    `생성 ${createdCount}건`,
    `수정 ${updatedCount}건`,
    `삭제 ${deletedCount}건`,
    `건너뜀 ${skippedCount}건`,
    `오류 ${errorCount}건`,
  ].join(', ');
};

export const buildApplyResultJson = (
  result: ApplyDraftResult,
): Record<string, unknown> => ({
  created: result.created,
  deleted: result.deleted,
  updated: result.updated,
  skipped: result.skipped,
  errors: result.errors,
});

export const toMutationName = (
  operation: 'create' | 'update' | 'delete',
  kind: EntityKind,
): string => `${operation}${toTitleCaseKey(kind)}`;

export const canApplyAction = (kind: EntityKind): boolean =>
  Boolean(ENTITY_CONFIG[kind]);

export const lookupCompanyByName = async (
  name: string,
): Promise<BasicCompanyRecord | null> => {
  const companies = await fetchCompanies();

  return (
    companies.find(
      (company) => normalizeText(company.name) === normalizeText(name),
    ) ?? null
  );
};
