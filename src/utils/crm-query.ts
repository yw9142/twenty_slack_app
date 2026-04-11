import type {
  BasicCompanyRecord,
  BasicNoteRecord,
  BasicOpportunityRecord,
  BasicPersonRecord,
  BasicTaskRecord,
  SlackIntentClassification,
  SlackReply,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import { synthesizeCrmQueryReply } from 'src/utils/intelligence';
import { normalizeText, truncate } from 'src/utils/strings';

const THIS_MONTH_PREFIX = new Date().toISOString().slice(0, 7);

const companyRichSelection = {
  id: true,
  name: true,
  createdAt: true,
  accountSegment: true,
  businessUnit: true,
  companyStatus: true,
  domainName: {
    primaryLinkUrl: true,
  },
  linkedinLink: {
    primaryLinkUrl: true,
  },
  employees: true,
} as const;

const companyBasicSelection = {
  id: true,
  name: true,
  createdAt: true,
} as const;

const personRichSelection = {
  id: true,
  createdAt: true,
  name: {
    firstName: true,
    lastName: true,
  },
  emails: {
    primaryEmail: true,
  },
  jobTitle: true,
  contactRoleType: true,
  linkedinLink: {
    primaryLinkUrl: true,
  },
  city: true,
  company: {
    name: true,
  },
} as const;

const personBasicSelection = {
  id: true,
  createdAt: true,
  name: {
    firstName: true,
    lastName: true,
  },
  emails: {
    primaryEmail: true,
  },
  jobTitle: true,
  company: {
    name: true,
  },
} as const;

const opportunityRichSelection = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  stage: true,
  closeDate: true,
  amount: {
    amountMicros: true,
    currencyCode: true,
  },
  company: {
    name: true,
  },
  pointOfContact: {
    name: {
      firstName: true,
      lastName: true,
    },
  },
  primaryVendorCompany: {
    name: true,
  },
  primaryPartnerCompany: {
    name: true,
  },
} as const;

const opportunityBasicSelection = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  stage: true,
  closeDate: true,
  company: {
    name: true,
  },
  pointOfContact: {
    name: {
      firstName: true,
      lastName: true,
    },
  },
  amount: {
    amountMicros: true,
    currencyCode: true,
  },
} as const;

type RichOrBasicSelection = Record<string, unknown>;
type ConnectionFilter = Record<string, unknown>;

const noteSelection = {
  id: true,
  title: true,
  createdAt: true,
  bodyV2: {
    markdown: true,
  },
} as const;

const taskSelection = {
  id: true,
  title: true,
  createdAt: true,
  status: true,
  dueAt: true,
  bodyV2: {
    markdown: true,
  },
} as const;

const noteTargetSelection = {
  targetOpportunity: {
    id: true,
  },
  note: noteSelection,
} as const;

const taskTargetSelection = {
  targetOpportunity: {
    id: true,
  },
  task: taskSelection,
} as const;

type OpportunityActivityBundle = {
  recentNotes: Array<{
    title: string;
    markdown: string;
    createdAt: string | null;
  }>;
  recentTasks: Array<{
    title: string;
    status: string | null;
    dueAt: string | null;
    markdown: string;
    createdAt: string | null;
  }>;
};

const toFullName = (
  name: Record<string, unknown> | null | undefined,
): string => {
  if (!name) {
    return '';
  }

  const firstName =
    typeof name.firstName === 'string' ? name.firstName.trim() : '';
  const lastName =
    typeof name.lastName === 'string' ? name.lastName.trim() : '';

  return `${firstName} ${lastName}`.trim();
};

const safeConnectionEdges = (
  value: Record<string, unknown> | null | undefined,
): Array<Record<string, unknown>> => {
  if (!value || !Array.isArray(value.edges)) {
    return [];
  }

  return value.edges
    .map((edge) =>
      edge && typeof edge === 'object' && edge.node && typeof edge.node === 'object'
        ? (edge.node as Record<string, unknown>)
        : null,
    )
    .filter((node): node is Record<string, unknown> => node !== null);
};

export const buildConnectionArgs = ({
  first = 100,
  filter,
}: {
  first?: number;
  filter?: ConnectionFilter;
}) => ({
  first,
  ...(filter ? { filter } : {}),
});

const queryWithFallback = async <
  TRecord extends Record<string, unknown>,
>({
  root,
  richSelection,
  fallbackSelection,
}: {
  root: string;
  richSelection: RichOrBasicSelection;
  fallbackSelection: RichOrBasicSelection;
}): Promise<TRecord[]> => {
  const client = createCoreClient();
  const buildSelection = (selection: RichOrBasicSelection) => ({
    [root]: {
      __args: buildConnectionArgs({
        first: 100,
      }),
      edges: {
        node: selection,
      },
    },
  });

  try {
    const response = await client.query<Record<string, unknown>>(
      buildSelection(richSelection),
    );

    return safeConnectionEdges(response[root] as Record<string, unknown>) as TRecord[];
  } catch {
    const response = await client.query<Record<string, unknown>>(
      buildSelection(fallbackSelection),
    );

    return safeConnectionEdges(response[root] as Record<string, unknown>) as TRecord[];
  }
};

export const fetchCompanies = async (): Promise<BasicCompanyRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'companies',
    richSelection: companyRichSelection,
    fallbackSelection: companyBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    accountSegment:
      typeof record.accountSegment === 'string' ? record.accountSegment : null,
    businessUnit:
      typeof record.businessUnit === 'string' ? record.businessUnit : null,
    companyStatus:
      typeof record.companyStatus === 'string' ? record.companyStatus : null,
    domainName:
      record.domainName &&
      typeof record.domainName === 'object' &&
      typeof (record.domainName as { primaryLinkUrl?: unknown }).primaryLinkUrl ===
        'string'
        ? ((record.domainName as { primaryLinkUrl?: string }).primaryLinkUrl ?? null)
        : null,
    linkedinLink:
      record.linkedinLink &&
      typeof record.linkedinLink === 'object' &&
      typeof (record.linkedinLink as { primaryLinkUrl?: unknown }).primaryLinkUrl ===
        'string'
        ? ((record.linkedinLink as { primaryLinkUrl?: string }).primaryLinkUrl ?? null)
        : null,
    employees:
      typeof record.employees === 'number' ? record.employees : null,
  }));
};

export const fetchPeople = async (): Promise<BasicPersonRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'people',
    richSelection: personRichSelection,
    fallbackSelection: personBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    fullName: toFullName(
      record.name && typeof record.name === 'object'
        ? (record.name as Record<string, unknown>)
        : null,
    ),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    primaryEmail:
      record.emails &&
      typeof record.emails === 'object' &&
      typeof (record.emails as { primaryEmail?: unknown }).primaryEmail ===
        'string'
        ? ((record.emails as { primaryEmail?: string }).primaryEmail ?? null)
        : null,
    jobTitle: typeof record.jobTitle === 'string' ? record.jobTitle : null,
    contactRoleType:
      typeof record.contactRoleType === 'string' ? record.contactRoleType : null,
    linkedinLink:
      record.linkedinLink &&
      typeof record.linkedinLink === 'object' &&
      typeof (record.linkedinLink as { primaryLinkUrl?: unknown }).primaryLinkUrl ===
        'string'
        ? ((record.linkedinLink as { primaryLinkUrl?: string }).primaryLinkUrl ??
          null)
        : null,
    city: typeof record.city === 'string' ? record.city : null,
    companyName:
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as { name?: unknown }).name === 'string'
        ? ((record.company as { name?: string }).name ?? null)
        : null,
  }));
};

export const fetchOpportunities = async (): Promise<BasicOpportunityRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'opportunities',
    richSelection: opportunityRichSelection,
    fallbackSelection: opportunityBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : '이름 없는 영업기회',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    stage: typeof record.stage === 'string' ? record.stage : null,
    closeDate: typeof record.closeDate === 'string' ? record.closeDate : null,
    companyName:
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as { name?: unknown }).name === 'string'
        ? ((record.company as { name?: string }).name ?? null)
        : null,
    primaryVendorCompanyName:
      record.primaryVendorCompany &&
      typeof record.primaryVendorCompany === 'object' &&
      typeof (record.primaryVendorCompany as { name?: unknown }).name ===
        'string'
        ? ((record.primaryVendorCompany as { name?: string }).name ?? null)
        : null,
    primaryPartnerCompanyName:
      record.primaryPartnerCompany &&
      typeof record.primaryPartnerCompany === 'object' &&
      typeof (record.primaryPartnerCompany as { name?: unknown }).name ===
        'string'
        ? ((record.primaryPartnerCompany as { name?: string }).name ?? null)
        : null,
    pointOfContactName:
      record.pointOfContact &&
      typeof record.pointOfContact === 'object' &&
      (record.pointOfContact as { name?: unknown }).name &&
      typeof (record.pointOfContact as { name?: unknown }).name === 'object'
        ? toFullName(
            (record.pointOfContact as { name?: Record<string, unknown> }).name,
          )
        : null,
    amountMicros:
      record.amount &&
      typeof record.amount === 'object' &&
      typeof (record.amount as { amountMicros?: unknown }).amountMicros ===
        'number'
        ? ((record.amount as { amountMicros?: number }).amountMicros ?? null)
        : null,
    currencyCode:
      record.amount &&
      typeof record.amount === 'object' &&
      typeof (record.amount as { currencyCode?: unknown }).currencyCode ===
        'string'
        ? ((record.amount as { currencyCode?: string }).currencyCode ?? null)
        : null,
  }));
};

export const fetchNotes = async (): Promise<BasicNoteRecord[]> => {
  const client = createCoreClient();
  const response = await client.query<{
    notes?: { edges: Array<{ node: Record<string, unknown> }> };
  }>({
    notes: {
      __args: buildConnectionArgs({
        first: 100,
      }),
      edges: {
        node: noteSelection,
      },
    },
  });

  return safeConnectionEdges(response.notes as Record<string, unknown>).map(
    (record) => ({
      id: typeof record.id === 'string' ? record.id : '',
      title: typeof record.title === 'string' ? record.title : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
      markdown:
        record.bodyV2 &&
        typeof record.bodyV2 === 'object' &&
        typeof (record.bodyV2 as { markdown?: unknown }).markdown === 'string'
          ? ((record.bodyV2 as { markdown?: string }).markdown ?? null)
          : null,
    }),
  );
};

export const fetchTasks = async (): Promise<BasicTaskRecord[]> => {
  const client = createCoreClient();
  const response = await client.query<{
    tasks?: { edges: Array<{ node: Record<string, unknown> }> };
  }>({
    tasks: {
      __args: buildConnectionArgs({
        first: 100,
      }),
      edges: {
        node: taskSelection,
      },
    },
  });

  return safeConnectionEdges(response.tasks as Record<string, unknown>).map(
    (record) => ({
      id: typeof record.id === 'string' ? record.id : '',
      title: typeof record.title === 'string' ? record.title : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
      status: typeof record.status === 'string' ? record.status : null,
      dueAt: typeof record.dueAt === 'string' ? record.dueAt : null,
      markdown:
        record.bodyV2 &&
        typeof record.bodyV2 === 'object' &&
        typeof (record.bodyV2 as { markdown?: unknown }).markdown === 'string'
          ? ((record.bodyV2 as { markdown?: string }).markdown ?? null)
          : null,
    }),
  );
};

const fetchNoteTargets = async (): Promise<
  Array<{
    targetOpportunityId: string | null;
    note: BasicNoteRecord | null;
  }>
> => {
  const client = createCoreClient();

  try {
    const response = await client.query<{
      noteTargets?: { edges: Array<{ node: Record<string, unknown> }> };
    }>({
      noteTargets: {
        __args: buildConnectionArgs({
          first: 200,
        }),
        edges: {
          node: noteTargetSelection,
        },
      },
    });

    return safeConnectionEdges(response.noteTargets as Record<string, unknown>).map(
      (record) => ({
        targetOpportunityId:
          record.targetOpportunity &&
          typeof record.targetOpportunity === 'object' &&
          typeof (record.targetOpportunity as { id?: unknown }).id === 'string'
            ? ((record.targetOpportunity as { id?: string }).id ?? null)
            : null,
        note:
          record.note && typeof record.note === 'object'
            ? {
                id:
                  typeof (record.note as { id?: unknown }).id === 'string'
                    ? ((record.note as { id?: string }).id ?? '')
                    : '',
                title:
                  typeof (record.note as { title?: unknown }).title === 'string'
                    ? ((record.note as { title?: string }).title ?? null)
                    : null,
                createdAt:
                  typeof (record.note as { createdAt?: unknown }).createdAt === 'string'
                    ? ((record.note as { createdAt?: string }).createdAt ?? null)
                    : null,
                markdown:
                  (record.note as { bodyV2?: Record<string, unknown> }).bodyV2 &&
                  typeof (record.note as { bodyV2?: Record<string, unknown> }).bodyV2 ===
                    'object' &&
                  typeof
                    (record.note as {
                      bodyV2?: { markdown?: unknown };
                    }).bodyV2?.markdown === 'string'
                    ? ((record.note as {
                        bodyV2?: { markdown?: string };
                      }).bodyV2?.markdown ?? null)
                    : null,
              }
            : null,
      }),
    );
  } catch {
    return [];
  }
};

const fetchTaskTargets = async (): Promise<
  Array<{
    targetOpportunityId: string | null;
    task: BasicTaskRecord | null;
  }>
> => {
  const client = createCoreClient();

  try {
    const response = await client.query<{
      taskTargets?: { edges: Array<{ node: Record<string, unknown> }> };
    }>({
      taskTargets: {
        __args: buildConnectionArgs({
          first: 200,
        }),
        edges: {
          node: taskTargetSelection,
        },
      },
    });

    return safeConnectionEdges(response.taskTargets as Record<string, unknown>).map(
      (record) => ({
        targetOpportunityId:
          record.targetOpportunity &&
          typeof record.targetOpportunity === 'object' &&
          typeof (record.targetOpportunity as { id?: unknown }).id === 'string'
            ? ((record.targetOpportunity as { id?: string }).id ?? null)
            : null,
        task:
          record.task && typeof record.task === 'object'
            ? {
                id:
                  typeof (record.task as { id?: unknown }).id === 'string'
                    ? ((record.task as { id?: string }).id ?? '')
                    : '',
                title:
                  typeof (record.task as { title?: unknown }).title === 'string'
                    ? ((record.task as { title?: string }).title ?? null)
                    : null,
                createdAt:
                  typeof (record.task as { createdAt?: unknown }).createdAt === 'string'
                    ? ((record.task as { createdAt?: string }).createdAt ?? null)
                    : null,
                status:
                  typeof (record.task as { status?: unknown }).status === 'string'
                    ? ((record.task as { status?: string }).status ?? null)
                    : null,
                dueAt:
                  typeof (record.task as { dueAt?: unknown }).dueAt === 'string'
                    ? ((record.task as { dueAt?: string }).dueAt ?? null)
                    : null,
                markdown:
                  (record.task as { bodyV2?: Record<string, unknown> }).bodyV2 &&
                  typeof (record.task as { bodyV2?: Record<string, unknown> }).bodyV2 ===
                    'object' &&
                  typeof
                    (record.task as {
                      bodyV2?: { markdown?: unknown };
                    }).bodyV2?.markdown === 'string'
                    ? ((record.task as {
                        bodyV2?: { markdown?: string };
                      }).bodyV2?.markdown ?? null)
                    : null,
              }
            : null,
      }),
    );
  } catch {
    return [];
  }
};

const buildOpportunityActivityMap = async (
  opportunities: BasicOpportunityRecord[],
): Promise<Record<string, OpportunityActivityBundle>> => {
  if (opportunities.length === 0) {
    return {};
  }

  const opportunityIds = new Set(opportunities.map((opportunity) => opportunity.id));
  const [noteTargets, taskTargets] = await Promise.all([
    fetchNoteTargets(),
    fetchTaskTargets(),
  ]);

  const activityMap: Record<string, OpportunityActivityBundle> = {};

  for (const opportunity of opportunities) {
    activityMap[opportunity.id] = {
      recentNotes: [],
      recentTasks: [],
    };
  }

  for (const noteTarget of noteTargets) {
    if (
      !noteTarget.targetOpportunityId ||
      !opportunityIds.has(noteTarget.targetOpportunityId) ||
      !noteTarget.note
    ) {
      continue;
    }

    activityMap[noteTarget.targetOpportunityId]?.recentNotes.push({
      title: noteTarget.note.title ?? '제목 미입력',
      markdown: noteTarget.note.markdown ?? '',
      createdAt: noteTarget.note.createdAt ?? null,
    });
  }

  for (const taskTarget of taskTargets) {
    if (
      !taskTarget.targetOpportunityId ||
      !opportunityIds.has(taskTarget.targetOpportunityId) ||
      !taskTarget.task
    ) {
      continue;
    }

    activityMap[taskTarget.targetOpportunityId]?.recentTasks.push({
      title: taskTarget.task.title ?? '제목 미입력',
      status: taskTarget.task.status ?? null,
      dueAt: taskTarget.task.dueAt ?? null,
      markdown: taskTarget.task.markdown ?? '',
      createdAt: taskTarget.task.createdAt ?? null,
    });
  }

  return activityMap;
};

const formatCurrency = ({
  amountMicros,
  currencyCode,
}: Pick<BasicOpportunityRecord, 'amountMicros' | 'currencyCode'>): string => {
  if (typeof amountMicros !== 'number') {
    return '미입력';
  }

  const amount = amountMicros / 1_000_000;
  const formatted = new Intl.NumberFormat('ko-KR').format(amount);

  return `${formatted} ${currencyCode ?? 'KRW'}`;
};

const sortNewestFirst = <T extends { createdAt?: string | null }>(items: T[]): T[] =>
  [...items].sort((left, right) =>
    (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
  );

const limitItems = <T>(items: T[], limit: number): T[] => items.slice(0, limit);

const toOpportunityContext = (opportunity: BasicOpportunityRecord) => ({
  name: opportunity.name,
  companyName: opportunity.companyName ?? '미지정',
  pointOfContactName: opportunity.pointOfContactName ?? '미지정',
  stage: opportunity.stage ?? '미입력',
  amount: formatCurrency(opportunity),
  closeDate: opportunity.closeDate ?? '미입력',
  primaryVendorCompanyName: opportunity.primaryVendorCompanyName ?? '미지정',
  primaryPartnerCompanyName: opportunity.primaryPartnerCompanyName ?? '미지정',
  createdAt: opportunity.createdAt ?? null,
  updatedAt: opportunity.updatedAt ?? null,
});

const toCompanyContext = (company: BasicCompanyRecord) => ({
  name: company.name ?? '이름 미입력',
  accountSegment: company.accountSegment ?? '미입력',
  businessUnit: company.businessUnit ?? '미입력',
  companyStatus: company.companyStatus ?? '미입력',
  domainName: company.domainName ?? '미입력',
  linkedinLink: company.linkedinLink ?? '미입력',
  employees: company.employees ?? null,
  createdAt: company.createdAt ?? null,
});

const toPersonContext = (person: BasicPersonRecord) => ({
  fullName: person.fullName || '이름 미입력',
  companyName: person.companyName ?? '미지정',
  primaryEmail: person.primaryEmail ?? '미입력',
  jobTitle: person.jobTitle ?? '미입력',
  contactRoleType: person.contactRoleType ?? '미입력',
  linkedinLink: person.linkedinLink ?? '미입력',
  city: person.city ?? '미입력',
  createdAt: person.createdAt ?? null,
});

const buildOpportunityNextAction = (
  activity: OpportunityActivityBundle | undefined,
): string => {
  const firstTask = activity?.recentTasks
    ?.slice()
    .sort((left, right) =>
      (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
    )[0];

  if (firstTask?.title) {
    return firstTask.dueAt
      ? `${firstTask.title} (기한 ${firstTask.dueAt})`
      : firstTask.title;
  }

  const firstNote = activity?.recentNotes
    ?.slice()
    .sort((left, right) =>
      (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
    )[0];

  if (firstNote?.markdown) {
    return truncate(firstNote.markdown, 100);
  }

  return '미입력';
};

const toOpportunityDetailedContext = (
  opportunity: BasicOpportunityRecord,
  activity: OpportunityActivityBundle | undefined,
) => ({
  ...toOpportunityContext(opportunity),
  nextAction: buildOpportunityNextAction(activity),
  recentTasks:
    activity?.recentTasks
      ?.slice()
      .sort((left, right) =>
        (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
      )
      .slice(0, 3) ?? [],
  recentNotes:
    activity?.recentNotes
      ?.slice()
      .sort((left, right) =>
        (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
      )
      .slice(0, 2) ?? [],
});

const flattenReplyText = (reply: SlackReply): string =>
  [
    reply.text,
    ...(reply.blocks ?? []).flatMap((block) => {
      const text =
        block &&
        typeof block === 'object' &&
        block.text &&
        typeof block.text === 'object' &&
        typeof (block.text as { text?: unknown }).text === 'string'
          ? [(block.text as { text: string }).text]
          : [];

      return text;
    }),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');

const isDetailedReplySufficient = ({
  classification,
  crmContext,
  reply,
}: {
  classification: SlackIntentClassification;
  crmContext: Record<string, unknown>;
  reply: SlackReply;
}): boolean => {
  if (classification.detailLevel !== 'DETAILED') {
    return true;
  }

  const flattened = flattenReplyText(reply);

  if (flattened.length < 120) {
    return false;
  }

  const opportunities = Array.isArray(crmContext.opportunities)
    ? crmContext.opportunities
        .filter(
          (item): item is { name?: string } =>
            Boolean(item) && typeof item === 'object',
        )
        .map((item) => item.name)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  if (opportunities.length > 0) {
    const requiredNames = opportunities.slice(0, Math.min(opportunities.length, 3));
    const matchedNames = requiredNames.filter((name) => flattened.includes(name));

    return matchedNames.length >= Math.min(requiredNames.length, 2);
  }

  const opportunity =
    crmContext.opportunity &&
    typeof crmContext.opportunity === 'object' &&
    typeof (crmContext.opportunity as { name?: unknown }).name === 'string'
      ? (crmContext.opportunity as { name: string })
      : null;

  if (opportunity?.name) {
    return flattened.includes(opportunity.name);
  }

  return true;
};

const maybeSynthesizeReply = async ({
  requestText,
  classification,
  crmContext,
  fallbackReply,
}: {
  requestText: string;
  classification: SlackIntentClassification;
  crmContext: Record<string, unknown>;
  fallbackReply: SlackReply;
}): Promise<SlackReply> => {
  const synthesized = await synthesizeCrmQueryReply({
    requestText,
    classification,
    crmContext,
  });

  if (!synthesized) {
    return fallbackReply;
  }

  return isDetailedReplySufficient({
    classification,
    crmContext,
    reply: synthesized,
  })
    ? synthesized
    : fallbackReply;
};

export const buildMonthlyNewOpinion = ({
  companyCount,
  peopleCount,
  opportunityCount,
}: {
  companyCount: number;
  peopleCount: number;
  opportunityCount: number;
}): string => {
  if (opportunityCount === 0) {
    return '이번달 신규 영업기회가 없어 신규 발굴 활동 점검이 필요합니다.';
  }

  if (peopleCount < companyCount) {
    return '신규 회사 수 대비 담당자 등록이 적어 후속 접점 확보가 필요합니다.';
  }

  if (opportunityCount >= companyCount) {
    return '신규 파이프라인 유입은 양호합니다. 상위 기회의 다음 액션을 빠르게 확정하세요.';
  }

  return '신규 접점은 생기고 있으니, 실제 딜 전환 여부를 이번 주 안에 점검하는 것이 좋습니다.';
};

export const buildOpportunityOpinion = (
  opportunity: Pick<
    BasicOpportunityRecord,
    | 'name'
    | 'stage'
    | 'closeDate'
    | 'primaryVendorCompanyName'
    | 'primaryPartnerCompanyName'
    | 'pointOfContactName'
  >,
): string => {
  const gaps: string[] = [];

  if (!opportunity.primaryVendorCompanyName) {
    gaps.push('주 벤더사');
  }

  if (
    opportunity.stage &&
    ['QUOTED', 'NEGOTIATION'].includes(opportunity.stage) &&
    !opportunity.primaryPartnerCompanyName
  ) {
    gaps.push('주 파트너사');
  }

  if (!opportunity.pointOfContactName) {
    gaps.push('주요 담당자');
  }

  if (!opportunity.closeDate) {
    gaps.push('예상 마감일');
  }

  if (gaps.length === 0) {
    return '핵심 상업 정보는 비교적 잘 채워져 있습니다. 다음 단계 진입 조건만 점검하면 됩니다.';
  }

  return `${gaps.join(', ')} 정보 보강이 필요합니다. 이 항목부터 정리한 뒤 다음 액션을 확정하세요.`;
};

const buildGeneralSummaryOpinion = ({
  opportunityCount,
  taskCount,
}: {
  opportunityCount: number;
  taskCount: number;
}): string => {
  if (opportunityCount === 0) {
    return '현재 파이프라인이 비어 있어 신규 기회 발굴 활동을 우선 점검해야 합니다.';
  }

  if (taskCount > opportunityCount) {
    return '오픈 작업 수가 많아 후속 우선순위 정리가 필요합니다.';
  }

  return '파이프라인과 후속 작업 수는 균형적인 편입니다. 상위 딜 중심으로 실행력을 점검하세요.';
};

const buildRiskOpinion = (count: number): string =>
  count === 0
    ? '현재 기준에서는 즉시 보완이 필요한 리스크 딜이 없습니다.'
    : '견적·협상 단계에서 벤더/파트너 정보가 빈 딜부터 우선 정리하는 것이 좋습니다.';

const findBestOpportunityMatch = (
  opportunities: BasicOpportunityRecord[],
  classification: SlackIntentClassification,
  text: string,
): BasicOpportunityRecord | null => {
  const hints = classification.entityHints.opportunities;
  const normalizedText = normalizeText(text);

  for (const hint of hints) {
    const match = opportunities.find((opportunity) =>
      normalizeText(opportunity.name).includes(normalizeText(hint)),
    );

    if (match) {
      return match;
    }
  }

  return (
    opportunities.find((opportunity) =>
      normalizedText.includes(normalizeText(opportunity.name)),
    ) ?? null
  );
};

const selectByTimeframe = <T extends { createdAt?: string | null }>(
  items: T[],
  timeframe: SlackIntentClassification['timeframe'],
): T[] => {
  if (timeframe === 'THIS_MONTH') {
    return items.filter((item) => item.createdAt?.startsWith(THIS_MONTH_PREFIX));
  }

  if (timeframe === 'RECENT') {
    return sortNewestFirst(items).slice(0, 10);
  }

  return sortNewestFirst(items);
};

const getMonthlyLabel = (timeframe: SlackIntentClassification['timeframe']): string =>
  timeframe === 'THIS_MONTH'
    ? '이번달 신규 현황'
    : timeframe === 'RECENT'
      ? '최근 신규 현황'
      : '신규 영업기회 현황';

const buildDetailedOpportunityBody = (
  opportunities: BasicOpportunityRecord[],
  activityMap: Record<string, OpportunityActivityBundle>,
): string =>
  opportunities
    .map((opportunity, index) => {
      const detailed = toOpportunityDetailedContext(
        opportunity,
        activityMap[opportunity.id],
      );
      const latestTask = detailed.recentTasks[0];
      const latestNote = detailed.recentNotes[0];
      const recentTaskText = latestTask
        ? latestTask.dueAt
          ? `${latestTask.title} (기한 ${latestTask.dueAt})`
          : latestTask.title
        : '미입력';
      const recentNoteText = latestNote
        ? truncate(latestNote.markdown || latestNote.title, 100)
        : '미입력';

      return [
        `${index + 1}. ${detailed.name}`,
        `- 회사: ${detailed.companyName}`,
        `- 담당자: ${detailed.pointOfContactName}`,
        `- 단계: ${detailed.stage}`,
        `- 금액: ${detailed.amount}`,
        `- 예상 마감일: ${detailed.closeDate}`,
        `- 주 벤더사: ${detailed.primaryVendorCompanyName}`,
        `- 주 파트너사: ${detailed.primaryPartnerCompanyName}`,
        `- 최근 메모: ${recentNoteText}`,
        `- 최근 작업: ${recentTaskText}`,
        `- 다음 액션: ${detailed.nextAction}`,
      ].join('\n');
    })
    .join('\n\n');

const buildMonthlyNewReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const [companies, people, opportunities] = await Promise.all([
    fetchCompanies(),
    fetchPeople(),
    fetchOpportunities(),
  ]);

  const scopedCompanies = selectByTimeframe(companies, classification.timeframe);
  const scopedPeople = selectByTimeframe(people, classification.timeframe);
  const scopedOpportunities = selectByTimeframe(
    opportunities,
    classification.timeframe,
  );
  const activityMap = await buildOpportunityActivityMap(scopedOpportunities);
  const companyCount = scopedCompanies.length;
  const peopleCount = scopedPeople.length;
  const opportunityCount = scopedOpportunities.length;
  const detailLimit = classification.detailLevel === 'DETAILED' ? 20 : 8;
  const queryLabel = getMonthlyLabel(classification.timeframe);
  const resultJson = {
    queryCategory: classification.queryCategory,
    detailLevel: classification.detailLevel,
    timeframe: classification.timeframe,
    companyCount,
    peopleCount,
    opportunityCount,
    companies: limitItems(scopedCompanies.map(toCompanyContext), detailLimit),
    people: limitItems(scopedPeople.map(toPersonContext), detailLimit),
    opportunities: limitItems(
      scopedOpportunities.map((opportunity) =>
        toOpportunityDetailedContext(opportunity, activityMap[opportunity.id]),
      ),
      detailLimit,
    ),
  };
  const fallbackReply =
    classification.detailLevel === 'DETAILED'
      ? ({
          text: `${queryLabel}을 상세 정리했습니다. 영업기회 ${opportunityCount}건입니다.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*${queryLabel}*\n` +
                  `• 회사: *${companyCount}건*\n` +
                  `• 담당자: *${peopleCount}건*\n` +
                  `• 영업기회: *${opportunityCount}건*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  opportunityCount === 0
                    ? '*신규 영업기회 상세*\n현재 조건에 맞는 영업기회가 없습니다.'
                    : `*신규 영업기회 상세*\n${buildDetailedOpportunityBody(
                        limitItems(scopedOpportunities, detailLimit),
                        activityMap,
                      )}`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*의견*\n${buildMonthlyNewOpinion({
                  companyCount,
                  peopleCount,
                  opportunityCount,
                })}`,
              },
            },
          ],
        } satisfies SlackReply)
      : ({
          text: `${queryLabel}입니다. 회사 ${companyCount}건, 담당자 ${peopleCount}건, 영업기회 ${opportunityCount}건입니다.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*${queryLabel}*\n` +
                  `• 회사: *${companyCount}건*\n` +
                  `• 담당자: *${peopleCount}건*\n` +
                  `• 영업기회: *${opportunityCount}건*`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*의견*\n${buildMonthlyNewOpinion({
                  companyCount,
                  peopleCount,
                  opportunityCount,
                })}`,
              },
            },
          ],
        } satisfies SlackReply);

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel,
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

const buildOpportunityStatusReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const opportunities = await fetchOpportunities();
  const match = findBestOpportunityMatch(opportunities, classification, text);

  if (!match) {
    return {
      reply: {
        text: '일치하는 영업기회를 찾지 못했습니다. 영업기회명이나 엔드고객명을 조금 더 구체적으로 알려주세요.',
      },
      resultJson: {
        found: false,
      },
    };
  }

  const resultJson = {
    found: true,
    opportunity: toOpportunityContext(match),
  };
  const fallbackReply = {
    text:
      `${match.name} 상태입니다. ` +
      `단계 ${match.stage ?? '미입력'}, ` +
      `엔드고객 ${match.companyName ?? '미지정'}, ` +
      `주 벤더사 ${match.primaryVendorCompanyName ?? '미지정'}, ` +
      `주 파트너사 ${match.primaryPartnerCompanyName ?? '미지정'}.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*${match.name}*\n` +
            `• 단계: ${match.stage ?? '미입력'}\n` +
            `• 엔드고객: ${match.companyName ?? '미지정'}\n` +
            `• 주 벤더사: ${match.primaryVendorCompanyName ?? '미지정'}\n` +
            `• 주 파트너사: ${match.primaryPartnerCompanyName ?? '미지정'}\n` +
            `• 예상 금액: ${formatCurrency(match)}\n` +
            `• 예상 마감일: ${match.closeDate ?? '미입력'}\n` +
            `• 주요 담당자: ${match.pointOfContactName ?? '미지정'}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildOpportunityOpinion(match)}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '영업기회 상태',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

const buildRiskReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const opportunities = await fetchOpportunities();
  const risky = opportunities.filter(
    (opportunity) =>
      (opportunity.stage &&
        ['VENDOR_ALIGNED', 'DISCOVERY_POC', 'QUOTED', 'NEGOTIATION'].includes(
          opportunity.stage,
        ) &&
        !opportunity.primaryVendorCompanyName) ||
      ((opportunity.stage === 'QUOTED' || opportunity.stage === 'NEGOTIATION') &&
        !opportunity.primaryPartnerCompanyName),
  );

  const lines = risky.slice(0, 5).map(
    (opportunity) =>
      `• ${opportunity.name} / 단계 ${opportunity.stage ?? '미입력'} / 벤더 ${opportunity.primaryVendorCompanyName ?? '미지정'} / 파트너 ${opportunity.primaryPartnerCompanyName ?? '미지정'}`,
  );
  const resultJson = {
    count: risky.length,
    opportunities: limitItems(
      risky.map(toOpportunityContext),
      classification.detailLevel === 'DETAILED' ? 20 : 8,
    ),
  };
  const fallbackReply = {
    text:
      risky.length === 0
        ? '현재 규칙 기준으로 감지된 리스크 영업기회가 없습니다.'
        : `리스크 영업기회 ${risky.length}건을 찾았습니다.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            risky.length === 0
              ? '*리스크 영업기회가 없습니다.*'
              : `*리스크 영업기회 ${risky.length}건*\n${lines.join('\n')}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildRiskOpinion(risky.length)}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '리스크 영업기회',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

const buildGeneralSummaryReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const [companies, people, opportunities, tasks, notes] = await Promise.all([
    fetchCompanies(),
    fetchPeople(),
    fetchOpportunities(),
    fetchTasks(),
    fetchNotes(),
  ]);
  const resultJson = {
    companyCount: companies.length,
    peopleCount: people.length,
    opportunityCount: opportunities.length,
    taskCount: tasks.length,
    noteCount: notes.length,
    topOpportunities: limitItems(
      sortNewestFirst(opportunities).map(toOpportunityContext),
      classification.detailLevel === 'DETAILED' ? 12 : 6,
    ),
    recentTasks: limitItems(
      sortNewestFirst(tasks).map((task) => ({
        title: task.title ?? '제목 미입력',
        status: task.status ?? '미입력',
        createdAt: task.createdAt ?? null,
      })),
      6,
    ),
    recentNotes: limitItems(
      sortNewestFirst(notes).map((note) => ({
        title: note.title ?? '제목 미입력',
        markdown: note.markdown ?? '',
        createdAt: note.createdAt ?? null,
      })),
      4,
    ),
  };
  const fallbackReply = {
    text:
      `현재 CRM 요약입니다. 회사 ${companies.length}건, 담당자 ${people.length}건, ` +
      `영업기회 ${opportunities.length}건, 작업 ${tasks.length}건, 노트 ${notes.length}건입니다.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*현재 CRM 요약*\n` +
            `• 회사: *${companies.length}건*\n` +
            `• 담당자: *${people.length}건*\n` +
            `• 영업기회: *${opportunities.length}건*\n` +
            `• 작업: *${tasks.length}건*\n` +
            `• 노트: *${notes.length}건*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildGeneralSummaryOpinion({
            opportunityCount: opportunities.length,
            taskCount: tasks.length,
          })}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '현재 CRM 요약',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

export const answerCrmQuery = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  if (classification.queryCategory === 'MONTHLY_NEW') {
    return buildMonthlyNewReply({ classification, text });
  }

  if (
    classification.queryCategory === 'OPPORTUNITY_STATUS' ||
    classification.entityHints.opportunities.length > 0
  ) {
    return buildOpportunityStatusReply({ classification, text });
  }

  if (classification.queryCategory === 'RISK_REVIEW') {
    return buildRiskReply({ classification, text });
  }

  return buildGeneralSummaryReply({ classification, text });
};
