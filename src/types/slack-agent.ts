import type {
  IntentType,
  ProcessingStatus,
  SlackSourceType,
} from 'src/constants/slack-intake';

export type EntityKind =
  | 'company'
  | 'person'
  | 'opportunity'
  | 'solution'
  | 'companyRelationship'
  | 'opportunityStakeholder'
  | 'opportunitySolution'
  | 'note'
  | 'task';

export type EntityOperation = 'create' | 'update';

export type EntityHints = {
  companies: string[];
  people: string[];
  opportunities: string[];
  solutions: string[];
};

export type QueryCategory =
  | 'MONTHLY_NEW'
  | 'OPPORTUNITY_STATUS'
  | 'RISK_REVIEW'
  | 'LICENSE_PRIORITY'
  | 'PIPELINE_SUMMARY'
  | 'RECORD_LOOKUP'
  | 'GENERAL';

export type QueryDetailLevel = 'SUMMARY' | 'DETAILED';

export type QueryTimeframe = 'THIS_MONTH' | 'RECENT' | 'ALL_TIME';

export type QueryFocusEntity =
  | 'GENERAL'
  | 'COMPANY'
  | 'PERSON'
  | 'LICENSE'
  | 'OPPORTUNITY'
  | 'TASK'
  | 'NOTE';

export type SlackIntentClassification = {
  intentType: IntentType;
  confidence: number;
  summary: string;
  queryCategory: QueryCategory;
  detailLevel: QueryDetailLevel;
  timeframe: QueryTimeframe;
  focusEntity: QueryFocusEntity;
  entityHints: EntityHints;
};

export type CrmActionRecord = {
  kind: EntityKind;
  operation: EntityOperation;
  lookup?: Record<string, string>;
  data: Record<string, unknown>;
};

export type DraftReviewField = {
  key: string;
  value: string;
};

export type DraftReviewItem = {
  kind: EntityKind;
  decision: 'CREATE' | 'UPDATE' | 'SKIP';
  target: string;
  matchedRecord?: string | null;
  reason?: string | null;
  fields: DraftReviewField[];
};

export type CrmWriteReview = {
  overview: string;
  opinion: string;
  items: DraftReviewItem[];
};

export type CrmWriteDraft = {
  summary: string;
  confidence: number;
  sourceText: string;
  actions: CrmActionRecord[];
  warnings: string[];
  review?: CrmWriteReview;
};

export type SlackBlock = Record<string, unknown>;

export type SlackReply = {
  text: string;
  blocks?: SlackBlock[];
};

export type SlackRequestRecord = {
  id: string;
  name: string | null;
  slackTeamId: string | null;
  slackChannelId: string | null;
  slackThreadTs: string | null;
  slackMessageTs: string | null;
  slackUserId: string | null;
  sourceType: SlackSourceType | null;
  slackResponseUrl: string | null;
  rawText: string | null;
  normalizedText: string | null;
  intentType: IntentType | null;
  processingStatus: ProcessingStatus | null;
  confidence: number | null;
  draftJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  dedupeKey: string | null;
  approvedByWorkspaceMemberId: string | null;
  receivedAt: string | null;
  lastProcessedAt: string | null;
};

export type BasicCompanyRecord = {
  id: string;
  name: string | null;
  createdAt?: string | null;
  accountSegment?: string | null;
  businessUnit?: string | null;
  companyStatus?: string | null;
  domainName?: string | null;
  linkedinLink?: string | null;
  employees?: number | null;
};

export type BasicPersonRecord = {
  id: string;
  fullName: string;
  createdAt?: string | null;
  primaryEmail?: string | null;
  jobTitle?: string | null;
  contactRoleType?: string | null;
  companyName?: string | null;
  linkedinLink?: string | null;
  city?: string | null;
};

export type BasicOpportunityRecord = {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  stage?: string | null;
  closeDate?: string | null;
  companyName?: string | null;
  pointOfContactName?: string | null;
  amountMicros?: number | null;
  currencyCode?: string | null;
};

export type BasicLicenseRecord = {
  id: string;
  name: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  licenseType?: string | null;
  vendorName?: string | null;
  productName?: string | null;
  expiryDate?: string | null;
  startDate?: string | null;
  seatCount?: number | null;
  contractValueMicros?: number | null;
  currencyCode?: string | null;
  renewalStage?: string | null;
  renewalRiskLevel?: string | null;
  lastActivityAt?: string | null;
  nextContactDueAt?: string | null;
  autoRenewal?: boolean | null;
  notesSummary?: string | null;
  vendorCompanyName?: string | null;
  partnerCompanyName?: string | null;
  endCustomerCompanyName?: string | null;
  solutionName?: string | null;
  renewalOpportunityName?: string | null;
  renewalOpportunityStage?: string | null;
};

export type BasicTaskRecord = {
  id: string;
  title: string | null;
  createdAt?: string | null;
  status?: string | null;
  dueAt?: string | null;
  markdown?: string | null;
};

export type BasicNoteRecord = {
  id: string;
  title: string | null;
  createdAt?: string | null;
  markdown?: string | null;
};

export type ApplyDraftResult = {
  created: Array<{ kind: EntityKind; id: string }>;
  updated: Array<{ kind: EntityKind; id: string }>;
  skipped: string[];
  errors: string[];
};
