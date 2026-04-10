import type {
  ApplyDraftResult,
  BasicCompanyRecord,
  BasicOpportunityRecord,
  BasicPersonRecord,
  CrmActionRecord,
  CrmWriteDraft,
  EntityKind,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import { fetchCompanies, fetchOpportunities, fetchPeople } from 'src/utils/crm-query';
import { toRichTextValue } from 'src/utils/rich-text';
import { normalizeText, splitFullName, toTitleCaseKey } from 'src/utils/strings';

type EntityConfig = {
  queryRoot: string;
  createMutation: string;
  updateMutation: string;
  idField: string;
};

const ENTITY_CONFIG: Record<EntityKind, EntityConfig> = {
  company: {
    queryRoot: 'companies',
    createMutation: 'createCompany',
    updateMutation: 'updateCompany',
    idField: 'id',
  },
  person: {
    queryRoot: 'people',
    createMutation: 'createPerson',
    updateMutation: 'updatePerson',
    idField: 'id',
  },
  opportunity: {
    queryRoot: 'opportunities',
    createMutation: 'createOpportunity',
    updateMutation: 'updateOpportunity',
    idField: 'id',
  },
  solution: {
    queryRoot: 'solutions',
    createMutation: 'createSolution',
    updateMutation: 'updateSolution',
    idField: 'id',
  },
  companyRelationship: {
    queryRoot: 'companyRelationships',
    createMutation: 'createCompanyRelationship',
    updateMutation: 'updateCompanyRelationship',
    idField: 'id',
  },
  opportunityStakeholder: {
    queryRoot: 'opportunityStakeholders',
    createMutation: 'createOpportunityStakeholder',
    updateMutation: 'updateOpportunityStakeholder',
    idField: 'id',
  },
  opportunitySolution: {
    queryRoot: 'opportunitySolutions',
    createMutation: 'createOpportunitySolution',
    updateMutation: 'updateOpportunitySolution',
    idField: 'id',
  },
  note: {
    queryRoot: 'notes',
    createMutation: 'createNote',
    updateMutation: 'updateNote',
    idField: 'id',
  },
  task: {
    queryRoot: 'tasks',
    createMutation: 'createTask',
    updateMutation: 'updateTask',
    idField: 'id',
  },
};

const normalizeLookupValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

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
): Promise<Record<string, unknown>> => {
  const nextData = { ...data };

  if (typeof nextData.companyName === 'string' && !nextData.companyId) {
    nextData.companyId = await lookupCompanyIdByName(nextData.companyName);
  }

  if (
    typeof nextData.primaryVendorCompanyName === 'string' &&
    !nextData.primaryVendorCompanyId
  ) {
    nextData.primaryVendorCompanyId = await lookupCompanyIdByName(
      nextData.primaryVendorCompanyName,
    );
  }

  if (
    typeof nextData.primaryPartnerCompanyName === 'string' &&
    !nextData.primaryPartnerCompanyId
  ) {
    nextData.primaryPartnerCompanyId = await lookupCompanyIdByName(
      nextData.primaryPartnerCompanyName,
    );
  }

  if (typeof nextData.pointOfContactName === 'string' && !nextData.pointOfContactId) {
    const person = await lookupPersonByReference({
      fullName: nextData.pointOfContactName,
      companyName:
        typeof nextData.companyName === 'string' ? nextData.companyName : undefined,
    });

    nextData.pointOfContactId = person?.id ?? null;
  }

  return nextData;
};

const normalizeEntityData = async (
  kind: EntityKind,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const nextData = await hydrateCommonReferenceIds(data);

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
  }

  if (kind === 'note' && typeof nextData.body === 'string' && !nextData.bodyV2) {
    nextData.bodyV2 = toRichTextValue(nextData.body);
    delete nextData.body;
  }

  if (kind === 'task' && typeof nextData.body === 'string' && !nextData.bodyV2) {
    nextData.bodyV2 = toRichTextValue(nextData.body);
    delete nextData.body;
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

  return nextData;
};

const findRecordIdByLookup = async (
  action: CrmActionRecord,
): Promise<string | null> => {
  if (!action.lookup) {
    return null;
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
}: {
  kind: EntityKind;
  data: Record<string, unknown>;
}): Promise<string> => {
  const client = createCoreClient();
  const config = ENTITY_CONFIG[kind];
  const normalizedData = await normalizeEntityData(kind, data);
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
}: {
  kind: EntityKind;
  id: string;
  data: Record<string, unknown>;
}): Promise<string> => {
  const client = createCoreClient();
  const config = ENTITY_CONFIG[kind];
  const normalizedData = await normalizeEntityData(kind, data);
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
    updated: [],
    skipped: [],
    errors: [],
  };

  for (const action of draft.actions) {
    try {
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
        });

        result.updated.push({
          kind: action.kind,
          id,
        });
        continue;
      }

      if (action.lookup) {
        const existingId = await findRecordIdByLookup(action);

        if (existingId) {
          const id = await updateRecord({
            kind: action.kind,
            id: existingId,
            data: action.data,
          });

          result.updated.push({
            kind: action.kind,
            id,
          });
          continue;
        }
      }

      const id = await createRecord({
        kind: action.kind,
        data: action.data,
      });

      result.created.push({
        kind: action.kind,
        id,
      });
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
  const updatedCount = result.updated.length;
  const skippedCount = result.skipped.length;
  const errorCount = result.errors.length;

  return [
    `생성 ${createdCount}건`,
    `수정 ${updatedCount}건`,
    `건너뜀 ${skippedCount}건`,
    `오류 ${errorCount}건`,
  ].join(', ');
};

export const buildApplyResultJson = (
  result: ApplyDraftResult,
): Record<string, unknown> => ({
  created: result.created,
  updated: result.updated,
  skipped: result.skipped,
  errors: result.errors,
});

export const toMutationName = (
  operation: 'create' | 'update',
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
