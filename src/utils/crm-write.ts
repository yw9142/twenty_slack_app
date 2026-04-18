import type {
  ApplyDraftResult,
  BasicCompanyRecord,
  BasicOpportunityRecord,
  BasicPersonRecord,
  CrmActionRecord,
  DraftReviewItem,
  CrmWriteDraft,
  EntityKind,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import {
  fetchCompanies,
  fetchNotes,
  fetchOpportunities,
  fetchPeople,
  fetchTasks,
} from 'src/utils/crm-query';
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

const toNormalizedKey = (value: string | null | undefined): string =>
  normalizeText(value);

const toPersonLookupKey = ({
  name,
  companyName,
}: {
  name: string | null | undefined;
  companyName?: string | null | undefined;
}): string => `${toNormalizedKey(name)}::${toNormalizedKey(companyName)}`;

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

  return nextData;
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
