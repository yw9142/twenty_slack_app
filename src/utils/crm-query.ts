import type {
  BasicCompanyRecord,
  BasicLicenseRecord,
  BasicNoteRecord,
  BasicOpportunityRecord,
  BasicPersonRecord,
  BasicTaskRecord,
  SlackIntentClassification,
  SlackReply,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import { buildDynamicObjectQueryReply } from 'src/utils/dynamic-object-query';
import type { AnthropicInvocationDiagnostics } from 'src/utils/intelligence';
import { synthesizeCrmQueryReplyWithDiagnostics } from 'src/utils/intelligence';
import { normalizeText, truncate } from 'src/utils/strings';
import {
  createWorkspaceQueryClient,
  isWorkspaceGraphqlQueryConfigured,
} from 'src/utils/workspace-graphql-client';

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

const licenseRichSelection = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  licenseType: true,
  vendorName: true,
  productName: true,
  expiryDate: true,
  startDate: true,
  seatCount: true,
  contractValue: {
    amountMicros: true,
    currencyCode: true,
  },
  currencyCode: true,
  renewalStage: true,
  renewalRiskLevel: true,
  lastActivityAt: true,
  nextContactDueAt: true,
  autoRenewal: true,
  notesSummary: true,
  vendorCompany: {
    name: true,
  },
  partnerCompany: {
    name: true,
  },
  endCustomerCompany: {
    name: true,
  },
  solution: {
    name: true,
  },
  renewalOpportunity: {
    name: true,
    stage: true,
  },
} as const;

const licenseBasicSelection = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  licenseType: true,
  vendorName: true,
  productName: true,
  expiryDate: true,
  startDate: true,
  seatCount: true,
  contractValue: {
    amountMicros: true,
    currencyCode: true,
  },
  currencyCode: true,
  renewalStage: true,
  renewalRiskLevel: true,
  lastActivityAt: true,
  nextContactDueAt: true,
  autoRenewal: true,
  notesSummary: true,
  endCustomerCompany: {
    name: true,
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
  const client = isWorkspaceGraphqlQueryConfigured()
    ? createWorkspaceQueryClient()
    : createCoreClient();
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

export const fetchLicenses = async (): Promise<BasicLicenseRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'licenses',
    richSelection: licenseRichSelection,
    fallbackSelection: licenseBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : '이름 없는 라이선스',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    licenseType:
      typeof record.licenseType === 'string' ? record.licenseType : null,
    vendorName:
      typeof record.vendorName === 'string' ? record.vendorName : null,
    productName:
      typeof record.productName === 'string' ? record.productName : null,
    expiryDate:
      typeof record.expiryDate === 'string' ? record.expiryDate : null,
    startDate: typeof record.startDate === 'string' ? record.startDate : null,
    seatCount: typeof record.seatCount === 'number' ? record.seatCount : null,
    contractValueMicros:
      record.contractValue &&
      typeof record.contractValue === 'object' &&
      typeof (record.contractValue as { amountMicros?: unknown }).amountMicros ===
        'number'
        ? ((record.contractValue as { amountMicros?: number }).amountMicros ?? null)
        : null,
    currencyCode:
      record.contractValue &&
      typeof record.contractValue === 'object' &&
      typeof (record.contractValue as { currencyCode?: unknown }).currencyCode ===
        'string'
        ? ((record.contractValue as { currencyCode?: string }).currencyCode ?? null)
        : typeof record.currencyCode === 'string'
          ? record.currencyCode
          : null,
    renewalStage:
      typeof record.renewalStage === 'string' ? record.renewalStage : null,
    renewalRiskLevel:
      typeof record.renewalRiskLevel === 'string'
        ? record.renewalRiskLevel
        : null,
    lastActivityAt:
      typeof record.lastActivityAt === 'string' ? record.lastActivityAt : null,
    nextContactDueAt:
      typeof record.nextContactDueAt === 'string'
        ? record.nextContactDueAt
        : null,
    autoRenewal:
      typeof record.autoRenewal === 'boolean' ? record.autoRenewal : null,
    notesSummary:
      typeof record.notesSummary === 'string' ? record.notesSummary : null,
    vendorCompanyName:
      record.vendorCompany &&
      typeof record.vendorCompany === 'object' &&
      typeof (record.vendorCompany as { name?: unknown }).name === 'string'
        ? ((record.vendorCompany as { name?: string }).name ?? null)
        : null,
    partnerCompanyName:
      record.partnerCompany &&
      typeof record.partnerCompany === 'object' &&
      typeof (record.partnerCompany as { name?: unknown }).name === 'string'
        ? ((record.partnerCompany as { name?: string }).name ?? null)
        : null,
    endCustomerCompanyName:
      record.endCustomerCompany &&
      typeof record.endCustomerCompany === 'object' &&
      typeof (record.endCustomerCompany as { name?: unknown }).name === 'string'
        ? ((record.endCustomerCompany as { name?: string }).name ?? null)
        : null,
    solutionName:
      record.solution &&
      typeof record.solution === 'object' &&
      typeof (record.solution as { name?: unknown }).name === 'string'
        ? ((record.solution as { name?: string }).name ?? null)
        : null,
    renewalOpportunityName:
      record.renewalOpportunity &&
      typeof record.renewalOpportunity === 'object' &&
      typeof (record.renewalOpportunity as { name?: unknown }).name === 'string'
        ? ((record.renewalOpportunity as { name?: string }).name ?? null)
        : null,
    renewalOpportunityStage:
      record.renewalOpportunity &&
      typeof record.renewalOpportunity === 'object' &&
      typeof (record.renewalOpportunity as { stage?: unknown }).stage === 'string'
        ? ((record.renewalOpportunity as { stage?: string }).stage ?? null)
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

const LICENSE_STAGE_LABELS: Record<string, string> = {
  ACTIVE: '활성',
  D90: '만료 90일 전',
  D45: '만료 45일 전',
  D30: '만료 30일 전',
  IN_RENEWAL: '갱신 진행중',
  PENDING_PROVISIONING: '발급 대기',
  RENEWED: '갱신 완료',
  EXPIRED: '만료',
  CHURNED: '이탈',
};

const LICENSE_RISK_LABELS: Record<string, string> = {
  LOW: '낮음',
  WATCH: '주의',
  HIGH: '높음',
};

const LICENSE_TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: '구독',
  SUPPORT_RENEWAL: '유지보수 갱신',
  PERPETUAL: '영구 라이선스',
  USAGE_BASED: '사용량 기반',
  OTHER: '기타',
};

const formatLicenseCurrency = ({
  contractValueMicros,
  currencyCode,
}: Pick<BasicLicenseRecord, 'contractValueMicros' | 'currencyCode'>): string => {
  if (typeof contractValueMicros !== 'number') {
    return '미입력';
  }

  const amount = contractValueMicros / 1_000_000;
  const formatted = new Intl.NumberFormat('ko-KR').format(amount);

  return `${formatted} ${currencyCode ?? 'KRW'}`;
};

const formatDateValue = (value: string | null | undefined): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.slice(0, 10) : '미입력';

const parseDateValue = (value: string | null | undefined): Date | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffInDaysFromNow = (value: string | null | undefined): number | null => {
  const parsed = parseDateValue(value);

  if (!parsed) {
    return null;
  }

  return Math.floor((parsed.getTime() - Date.now()) / 86_400_000);
};

const daysSinceNow = (value: string | null | undefined): number | null => {
  const parsed = parseDateValue(value);

  if (!parsed) {
    return null;
  }

  return Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
};

const formatLicenseStage = (value: string | null | undefined): string =>
  (value && LICENSE_STAGE_LABELS[value]) || value || '미입력';

const formatLicenseRisk = (value: string | null | undefined): string =>
  (value && LICENSE_RISK_LABELS[value]) || value || '미입력';

const formatLicenseType = (value: string | null | undefined): string =>
  (value && LICENSE_TYPE_LABELS[value]) || value || '미입력';

const buildLicensePriorityScore = (license: BasicLicenseRecord): number => {
  let score = 0;

  switch (license.renewalRiskLevel) {
    case 'HIGH':
      score += 80;
      break;
    case 'WATCH':
      score += 45;
      break;
    case 'LOW':
      score += 10;
      break;
    default:
      score += 15;
      break;
  }

  switch (license.renewalStage) {
    case 'EXPIRED':
      score += 90;
      break;
    case 'D30':
      score += 60;
      break;
    case 'D45':
      score += 45;
      break;
    case 'D90':
      score += 25;
      break;
    case 'IN_RENEWAL':
      score += 20;
      break;
    case 'ACTIVE':
      score += 10;
      break;
    case 'RENEWED':
      score -= 25;
      break;
    case 'CHURNED':
      score -= 35;
      break;
    default:
      break;
  }

  const expiryDays = diffInDaysFromNow(license.expiryDate);

  if (expiryDays !== null) {
    if (expiryDays <= 0) {
      score += 90;
    } else if (expiryDays <= 30) {
      score += 65;
    } else if (expiryDays <= 45) {
      score += 50;
    } else if (expiryDays <= 90) {
      score += 30;
    } else if (expiryDays <= 180) {
      score += 10;
    }
  }

  const nextContactDays = diffInDaysFromNow(license.nextContactDueAt);

  if (nextContactDays !== null) {
    if (nextContactDays < 0) {
      score += 30;
    } else if (nextContactDays <= 7) {
      score += 15;
    }
  }

  const idleDays = daysSinceNow(license.lastActivityAt);

  if (idleDays === null) {
    score += 18;
  } else if (idleDays >= 60) {
    score += 30;
  } else if (idleDays >= 30) {
    score += 18;
  }

  if (typeof license.contractValueMicros === 'number') {
    const amount = license.contractValueMicros / 1_000_000;

    if (amount >= 100_000_000) {
      score += 20;
    } else if (amount >= 50_000_000) {
      score += 10;
    }
  }

  if (license.autoRenewal) {
    score -= 10;
  }

  return score;
};

const buildLicensePriorityReasons = (license: BasicLicenseRecord): string[] => {
  const reasons: string[] = [];
  const expiryDays = diffInDaysFromNow(license.expiryDate);
  const nextContactDays = diffInDaysFromNow(license.nextContactDueAt);
  const idleDays = daysSinceNow(license.lastActivityAt);

  if (license.renewalRiskLevel === 'HIGH') {
    reasons.push('갱신 리스크가 높음');
  } else if (license.renewalRiskLevel === 'WATCH') {
    reasons.push('갱신 리스크 주의 단계');
  }

  if (expiryDays !== null) {
    if (expiryDays <= 0) {
      reasons.push('이미 만료되었거나 만료 임박');
    } else if (expiryDays <= 30) {
      reasons.push(`${expiryDays}일 이내 만료`);
    } else if (expiryDays <= 45) {
      reasons.push(`${expiryDays}일 후 만료`);
    } else if (expiryDays <= 90) {
      reasons.push(`${expiryDays}일 후 만료 예정`);
    }
  }

  if (nextContactDays !== null) {
    if (nextContactDays < 0) {
      reasons.push('다음 접점 예정일이 지났음');
    } else if (nextContactDays <= 7) {
      reasons.push('다음 접점 예정일이 7일 이내');
    }
  }

  if (idleDays === null) {
    reasons.push('최근 활동 이력이 없음');
  } else if (idleDays >= 30) {
    reasons.push(`최근 활동이 ${idleDays}일 전`);
  }

  if (typeof license.contractValueMicros === 'number') {
    const amount = license.contractValueMicros / 1_000_000;

    if (amount >= 50_000_000) {
      reasons.push(`계약 규모 ${new Intl.NumberFormat('ko-KR').format(amount)} ${license.currencyCode ?? 'KRW'}`);
    }
  }

  if (license.autoRenewal) {
    reasons.push('자동 갱신 계약');
  }

  return reasons.slice(0, 4);
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

const toLicenseContext = (license: BasicLicenseRecord) => ({
  name: license.name,
  endCustomerCompanyName: license.endCustomerCompanyName ?? '미지정',
  vendorName: license.vendorName ?? license.vendorCompanyName ?? '미지정',
  productName: license.productName ?? '미입력',
  solutionName: license.solutionName ?? '미입력',
  licenseType: formatLicenseType(license.licenseType),
  renewalStage: formatLicenseStage(license.renewalStage),
  renewalRiskLevel: formatLicenseRisk(license.renewalRiskLevel),
  expiryDate: formatDateValue(license.expiryDate),
  startDate: formatDateValue(license.startDate),
  seatCount: license.seatCount ?? null,
  contractValue: formatLicenseCurrency(license),
  autoRenewal:
    typeof license.autoRenewal === 'boolean'
      ? license.autoRenewal
        ? '예'
        : '아니오'
      : '미입력',
  lastActivityAt: formatDateValue(license.lastActivityAt),
  nextContactDueAt: formatDateValue(license.nextContactDueAt),
  notesSummary: license.notesSummary ?? '미입력',
  partnerCompanyName: license.partnerCompanyName ?? '미지정',
  renewalOpportunityName: license.renewalOpportunityName ?? '미지정',
  renewalOpportunityStage:
    formatLicenseStage(license.renewalOpportunityStage),
  priorityScore: buildLicensePriorityScore(license),
  priorityReasons: buildLicensePriorityReasons(license),
});

const buildDetailedLicenseBody = (licenses: BasicLicenseRecord[]): string =>
  licenses
    .map((license, index) => {
      const context = toLicenseContext(license);

      return [
        `${index + 1}. ${context.name}`,
        `- 엔드고객: ${context.endCustomerCompanyName}`,
        `- 제품/솔루션: ${context.productName} / ${context.solutionName}`,
        `- 벤더: ${context.vendorName}`,
        `- 유형: ${context.licenseType}`,
        `- 갱신 단계: ${context.renewalStage}`,
        `- 갱신 리스크: ${context.renewalRiskLevel}`,
        `- 만료일: ${context.expiryDate}`,
        `- 다음 접점 예정일: ${context.nextContactDueAt}`,
        `- 최근 활동일: ${context.lastActivityAt}`,
        `- 계약 금액: ${context.contractValue}`,
        `- 수량: ${context.seatCount ?? '미입력'}`,
        `- 자동 갱신: ${context.autoRenewal}`,
        `- 연결 영업기회: ${context.renewalOpportunityName} / ${context.renewalOpportunityStage}`,
        `- 우선순위 근거: ${context.priorityReasons.join(', ') || '근거 부족'}`,
        `- 메모: ${truncate(context.notesSummary, 140)}`,
      ].join('\n');
    })
    .join('\n\n');

const buildLicensePriorityOpinion = (licenses: BasicLicenseRecord[]): string => {
  if (licenses.length === 0) {
    return '조건에 맞는 라이선스가 없어 즉시 검토할 갱신 대상이 없습니다.';
  }

  const top = toLicenseContext(licenses[0]);

  return `${top.endCustomerCompanyName}의 ${top.productName} 갱신을 최우선으로 보세요. ${top.priorityReasons.join(', ')} 기준으로 후속 접점을 먼저 잡는 것이 좋습니다.`;
};

const splitSlackBodyIntoChunks = (
  body: string,
  maxLength = 2800,
): string[] => {
  if (body.length <= maxLength) {
    return [body];
  }

  const paragraphs = body.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    const lines = paragraph.split('\n');
    let lineChunk = '';

    for (const line of lines) {
      const lineCandidate =
        lineChunk.length === 0 ? line : `${lineChunk}\n${line}`;

      if (lineCandidate.length <= maxLength) {
        lineChunk = lineCandidate;
        continue;
      }

      if (lineChunk.length > 0) {
        chunks.push(lineChunk);
      }

      lineChunk = line;
    }

    current = lineChunk;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
};

const buildSectionBlocks = (title: string, body: string): Record<string, unknown>[] =>
  splitSlackBodyIntoChunks(body).map((chunk, index) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${index === 0 ? title : `${title} (계속)`}*\n${chunk}`,
    },
  }));

const matchesLicenseQuery = ({
  license,
  classification,
  text,
}: {
  license: BasicLicenseRecord;
  classification: SlackIntentClassification;
  text: string;
}): boolean => {
  const targets = [
    license.name,
    license.endCustomerCompanyName,
    license.vendorName,
    license.vendorCompanyName,
    license.partnerCompanyName,
    license.productName,
    license.solutionName,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeText(value));

  const hints = [
    ...classification.entityHints.companies,
    ...classification.entityHints.solutions,
  ]
    .filter((value) => value.trim().length > 0)
    .map((value) => normalizeText(value));
  const normalizedText = normalizeText(text);

  if (hints.length === 0) {
    return true;
  }

  return hints.some((hint) =>
    targets.some((target) => target.includes(hint) || normalizedText.includes(target)),
  );
};

const selectLicensesByTimeframe = (
  licenses: BasicLicenseRecord[],
  timeframe: SlackIntentClassification['timeframe'],
): BasicLicenseRecord[] => {
  if (timeframe === 'THIS_MONTH') {
    return licenses.filter(
      (license) =>
        license.expiryDate?.startsWith(THIS_MONTH_PREFIX) ||
        license.nextContactDueAt?.startsWith(THIS_MONTH_PREFIX) ||
        license.createdAt?.startsWith(THIS_MONTH_PREFIX),
    );
  }

  if (timeframe === 'RECENT') {
    return licenses
      .slice()
      .sort(
        (left, right) =>
          buildLicensePriorityScore(right) - buildLicensePriorityScore(left),
      )
      .slice(0, 10);
  }

  return licenses;
};

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
}): Promise<{
  reply: SlackReply;
  aiDiagnostics: AnthropicInvocationDiagnostics;
  replySource: 'anthropic' | 'fallback';
}> => {
  const synthesized = await synthesizeCrmQueryReplyWithDiagnostics({
    requestText,
    classification,
    crmContext,
  });

  if (!synthesized.reply) {
    return {
      reply: fallbackReply,
      aiDiagnostics: synthesized.aiDiagnostics,
      replySource: 'fallback',
    };
  }

  if (
    isDetailedReplySufficient({
      classification,
      crmContext,
      reply: synthesized.reply,
    })
  ) {
    return {
      reply: synthesized.reply,
      aiDiagnostics: synthesized.aiDiagnostics,
      replySource: 'anthropic',
    };
  }

  return {
    reply: fallbackReply,
    aiDiagnostics: {
      ...synthesized.aiDiagnostics,
      succeeded: false,
      reason: 'insufficient_reply',
      errorMessage:
        'Anthropic reply was present but fell below the sufficiency threshold',
    },
    replySource: 'fallback',
  };
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
    'name' | 'stage' | 'closeDate' | 'pointOfContactName' | 'companyName'
  >,
): string => {
  const gaps: string[] = [];

  if (!opportunity.pointOfContactName) {
    gaps.push('주요 담당자');
  }

  if (!opportunity.closeDate) {
    gaps.push('예상 마감일');
  }

  if (!opportunity.companyName) {
    gaps.push('고객사');
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
    : '진행 단계 대비 담당자, 예상 마감일, 최근 활동이 빈 딜부터 우선 정리하는 것이 좋습니다.';

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

  const synthesized = await maybeSynthesizeReply({
    requestText: text,
    classification,
    crmContext: {
      queryLabel,
      ...resultJson,
    },
    fallbackReply,
  });

  return {
    reply: synthesized.reply,
    resultJson: {
      ...resultJson,
      aiDiagnostics: {
        querySynthesis: synthesized.aiDiagnostics,
      },
      replySource: synthesized.replySource,
    },
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
      `담당자 ${match.pointOfContactName ?? '미지정'}.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*${match.name}*\n` +
            `• 단계: ${match.stage ?? '미입력'}\n` +
            `• 엔드고객: ${match.companyName ?? '미지정'}\n` +
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

  const synthesized = await maybeSynthesizeReply({
    requestText: text,
    classification,
    crmContext: {
      queryLabel: '영업기회 상태',
      ...resultJson,
    },
    fallbackReply,
  });

  return {
    reply: synthesized.reply,
    resultJson: {
      ...resultJson,
      aiDiagnostics: {
        querySynthesis: synthesized.aiDiagnostics,
      },
      replySource: synthesized.replySource,
    },
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
        !opportunity.pointOfContactName) ||
      ((opportunity.stage === 'QUOTED' || opportunity.stage === 'NEGOTIATION') &&
        !opportunity.closeDate),
  );

  const lines = risky.slice(0, 5).map(
    (opportunity) =>
      `• ${opportunity.name} / 단계 ${opportunity.stage ?? '미입력'} / 담당자 ${opportunity.pointOfContactName ?? '미지정'} / 예상 마감일 ${opportunity.closeDate ?? '미지정'}`,
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

  const synthesized = await maybeSynthesizeReply({
    requestText: text,
    classification,
    crmContext: {
      queryLabel: '리스크 영업기회',
      ...resultJson,
    },
    fallbackReply,
  });

  return {
    reply: synthesized.reply,
    resultJson: {
      ...resultJson,
      aiDiagnostics: {
        querySynthesis: synthesized.aiDiagnostics,
      },
      replySource: synthesized.replySource,
    },
  };
};

const buildLicensePriorityReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const licenses = await fetchLicenses();
  const scopedLicenses = selectLicensesByTimeframe(
    licenses.filter((license) =>
      matchesLicenseQuery({
        license,
        classification,
        text,
      }),
    ),
    classification.timeframe,
  )
    .slice()
    .sort((left, right) => {
      const scoreDiff =
        buildLicensePriorityScore(right) - buildLicensePriorityScore(left);

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return (left.expiryDate ?? '9999-12-31').localeCompare(
        right.expiryDate ?? '9999-12-31',
      );
    });

  if (scopedLicenses.length === 0) {
    return {
      reply: {
        text: '조건에 맞는 라이선스를 찾지 못했습니다. 고객사, 벤더, 제품명 또는 기간을 조금 더 구체적으로 알려주세요.',
      },
      resultJson: {
        found: false,
        count: 0,
      },
    };
  }

  const queryLabel =
    classification.timeframe === 'THIS_MONTH'
      ? '이번달 라이선스 우선순위 보고서'
      : classification.timeframe === 'RECENT'
        ? '최근 라이선스 우선순위 보고서'
        : '라이선스 우선순위 보고서';
  const contextLimit =
    classification.detailLevel === 'DETAILED'
      ? Math.min(scopedLicenses.length, 25)
      : Math.min(scopedLicenses.length, 8);
  const reportLicenses = scopedLicenses.slice(0, contextLimit);
  const highRiskCount = scopedLicenses.filter(
    (license) => license.renewalRiskLevel === 'HIGH',
  ).length;
  const expiringSoonCount = scopedLicenses.filter((license) => {
    const expiryDays = diffInDaysFromNow(license.expiryDate);

    return expiryDays !== null && expiryDays <= 45;
  }).length;
  const resultJson = {
    queryCategory: classification.queryCategory,
    detailLevel: classification.detailLevel,
    timeframe: classification.timeframe,
    count: scopedLicenses.length,
    highRiskCount,
    expiringSoonCount,
    licenses: reportLicenses.map(toLicenseContext),
    priorityBasis: [
      'renewalRiskLevel',
      'renewalStage',
      'expiryDate',
      'nextContactDueAt',
      'lastActivityAt',
      'contractValue',
    ],
  };
  const detailBody = buildDetailedLicenseBody(reportLicenses);
  const summaryBody =
    `• 대상 라이선스: *${scopedLicenses.length}건*\n` +
    `• 고위험 갱신: *${highRiskCount}건*\n` +
    `• 45일 이내 만료/임박: *${expiringSoonCount}건*`;
  const fallbackReply =
    classification.detailLevel === 'DETAILED'
      ? ({
          text: `우선순위가 높은 라이선스 갱신 대상을 순서대로 정리했습니다. 대상 ${scopedLicenses.length}건입니다.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${queryLabel}*\n${summaryBody}`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  '*우선순위 기준*\n' +
                  '갱신 리스크, 만료일, 갱신 단계, 최근 활동 공백, 다음 접점 예정일, 계약 규모를 함께 반영했습니다.',
              },
            },
            ...buildSectionBlocks('라이선스 상세', detailBody),
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*의견*\n${buildLicensePriorityOpinion(reportLicenses)}`,
              },
            },
          ],
        } satisfies SlackReply)
      : ({
          text: `우선순위가 높은 라이선스 갱신 대상을 정리했습니다. 대상 ${scopedLicenses.length}건입니다.`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${queryLabel}*\n${summaryBody}`,
              },
            },
            ...buildSectionBlocks(
              '상위 갱신 대상',
              buildDetailedLicenseBody(reportLicenses.slice(0, 5)),
            ),
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*의견*\n${buildLicensePriorityOpinion(reportLicenses)}`,
              },
            },
          ],
        } satisfies SlackReply);

  const synthesized = await maybeSynthesizeReply({
    requestText: text,
    classification,
    crmContext: {
      queryLabel,
      ...resultJson,
    },
    fallbackReply,
  });

  return {
    reply: synthesized.reply,
    resultJson: {
      ...resultJson,
      aiDiagnostics: {
        querySynthesis: synthesized.aiDiagnostics,
      },
      replySource: synthesized.replySource,
    },
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

  const synthesized = await maybeSynthesizeReply({
    requestText: text,
    classification,
    crmContext: {
      queryLabel: '현재 CRM 요약',
      ...resultJson,
    },
    fallbackReply,
  });

  return {
    reply: synthesized.reply,
    resultJson: {
      ...resultJson,
      aiDiagnostics: {
        querySynthesis: synthesized.aiDiagnostics,
      },
      replySource: synthesized.replySource,
    },
  };
};

type CrmQueryRoute =
  | 'MONTHLY_NEW'
  | 'OPPORTUNITY_STATUS'
  | 'RISK_REVIEW'
  | 'LICENSE_PRIORITY'
  | 'METADATA_DYNAMIC'
  | 'GENERAL';

type CrmQueryRouteDecision = {
  route: CrmQueryRoute;
  legacyFallback: boolean;
  fallbackRoute?: Exclude<CrmQueryRoute, 'METADATA_DYNAMIC'>;
};

type CrmQueryHandler = typeof buildMonthlyNewReply;

const metadataAwareDynamicHandler = buildDynamicObjectQueryReply;

const CRM_QUERY_HANDLER_REGISTRY: Partial<
  Record<Exclude<CrmQueryRoute, 'METADATA_DYNAMIC'>, CrmQueryHandler>
> = {
  MONTHLY_NEW: buildMonthlyNewReply,
  OPPORTUNITY_STATUS: buildOpportunityStatusReply,
  RISK_REVIEW: buildRiskReply,
  LICENSE_PRIORITY: buildLicensePriorityReply,
  GENERAL: buildGeneralSummaryReply,
};

const resolveCrmQueryRoute = (
  classification: SlackIntentClassification,
): CrmQueryRouteDecision => {
  if (
    classification.queryCategory === 'LICENSE_PRIORITY' ||
    classification.focusEntity === 'LICENSE'
  ) {
    return {
      route: 'METADATA_DYNAMIC',
      legacyFallback: false,
      fallbackRoute: 'LICENSE_PRIORITY',
    };
  }

  if (classification.queryCategory === 'MONTHLY_NEW') {
    return {
      route: 'MONTHLY_NEW',
      legacyFallback: false,
    };
  }

  if (classification.queryCategory === 'OPPORTUNITY_STATUS') {
    return {
      route: 'OPPORTUNITY_STATUS',
      legacyFallback: false,
    };
  }

  if (classification.queryCategory === 'RISK_REVIEW') {
    return {
      route: 'RISK_REVIEW',
      legacyFallback: false,
    };
  }

  if (
    classification.queryCategory === 'PIPELINE_SUMMARY' ||
    classification.queryCategory === 'RECORD_LOOKUP'
  ) {
    return {
      route: 'METADATA_DYNAMIC',
      legacyFallback: false,
    };
  }

  // Legacy compatibility: keep the old opportunity-hint shortcut until planner coverage is fully reliable.
  if (classification.entityHints.opportunities.length > 0) {
    return {
      route: 'OPPORTUNITY_STATUS',
      legacyFallback: true,
    };
  }

  return {
    route: 'GENERAL',
    legacyFallback: false,
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
  const route = resolveCrmQueryRoute(classification);
  const handler = CRM_QUERY_HANDLER_REGISTRY[route.route];

  if (route.route === 'METADATA_DYNAMIC') {
    if (metadataAwareDynamicHandler) {
      const dynamicResult = await metadataAwareDynamicHandler({
        classification,
        text,
      });

      if (dynamicResult.handled) {
        return {
          reply: dynamicResult.reply,
          resultJson: dynamicResult.resultJson,
        };
      }
    }

    if (route.fallbackRoute) {
      const fallbackHandler = CRM_QUERY_HANDLER_REGISTRY[route.fallbackRoute];

      if (fallbackHandler) {
        return fallbackHandler({ classification, text });
      }
    }

    return buildGeneralSummaryReply({ classification, text });
  }

  if (handler) {
    return handler({ classification, text });
  }

  return buildGeneralSummaryReply({ classification, text });
};
