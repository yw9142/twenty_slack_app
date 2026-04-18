import type { EntityKind } from 'src/types/slack-agent';

export type ToolVisibility = 'model_visible' | 'internal';

export type ToolDescriptor = {
  name: string;
  description: string;
  policy: string;
  inputSchema: Record<string, unknown>;
  visibility: ToolVisibility;
};

export type ToolCatalog = {
  modelVisibleTools: ToolDescriptor[];
  internalTools: ToolDescriptor[];
};

export const ENTITY_KIND_VALUES: EntityKind[] = [
  'company',
  'person',
  'opportunity',
  'solution',
  'companyRelationship',
  'opportunityStakeholder',
  'opportunitySolution',
  'note',
  'task',
];

export const CREATE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ENTITY_KIND_VALUES,
    },
    data: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['kind', 'data'],
} as const;

export const UPDATE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ENTITY_KIND_VALUES,
    },
    targetId: {
      type: 'string',
    },
    lookup: {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    },
    data: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['kind', 'data'],
  anyOf: [{ required: ['targetId'] }, { required: ['lookup'] }],
} as const;

export const DELETE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ENTITY_KIND_VALUES,
    },
    targetId: {
      type: 'string',
    },
    lookup: {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    },
  },
  required: ['kind'],
  anyOf: [{ required: ['targetId'] }, { required: ['lookup'] }],
} as const;

export const QUERY_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: {
      type: 'string',
    },
  },
  required: ['query'],
} as const;

const slackRequestIdInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slackRequestId: {
      type: 'string',
    },
  },
  required: ['slackRequestId'],
} as const;

const replyInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slackRequestId: {
      type: 'string',
    },
    reply: {
      type: 'object',
      additionalProperties: true,
    },
    resultJson: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['slackRequestId', 'reply'],
} as const;

const errorInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    slackRequestId: {
      type: 'string',
    },
    errorMessage: {
      type: 'string',
    },
    message: {
      type: 'string',
    },
    resultJson: {
      type: 'object',
      additionalProperties: true,
    },
  },
  required: ['slackRequestId'],
} as const;

const toolDescriptor = (
  descriptor: Omit<ToolDescriptor, 'visibility'> & {
    visibility?: ToolVisibility;
  },
): ToolDescriptor => ({
  visibility: descriptor.visibility ?? 'internal',
  ...descriptor,
});

const searchPolicy =
  'Read-only. Use for query/list/report requests and summarize the retrieved records in Slack. If the user asks for a broad list without filters, call the tool with { "query": "" } and then report the results.';

const approvalPolicy =
  'Do not mutate. Return a planned action with review metadata so the request can be approved before write.';

const immediateCreatePolicy =
  'Execute immediately. Return the created record id, then persist the applied result through the internal runner flow.';

export const TOOL_CATALOG: ToolCatalog = {
  modelVisibleTools: [
    toolDescriptor({
      name: 'search-companies',
      description: 'Search companies by name, segment, business unit, status, or link',
      policy: searchPolicy,
      inputSchema: QUERY_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'search-people',
      description: 'Search people by name, email, role, company, city, or link',
      policy: searchPolicy,
      inputSchema: QUERY_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'search-opportunities',
      description: 'Search opportunities by name, stage, close date, company, or contact',
      policy: searchPolicy,
      inputSchema: QUERY_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'search-licenses',
      description: 'Search licenses by name, vendor, product, renewal risk, or date',
      policy: searchPolicy,
      inputSchema: QUERY_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'search-activities',
      description: 'Search notes and tasks by title, markdown body, or status',
      policy: searchPolicy,
      inputSchema: QUERY_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'create-record',
      description: 'Create a CRM record immediately',
      policy: immediateCreatePolicy,
      inputSchema: CREATE_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'update-record',
      description: 'Plan a CRM record update and return approval metadata',
      policy: approvalPolicy,
      inputSchema: UPDATE_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
    toolDescriptor({
      name: 'delete-record',
      description: 'Plan a CRM record delete and return approval metadata',
      policy: approvalPolicy,
      inputSchema: DELETE_TOOL_INPUT_SCHEMA,
      visibility: 'model_visible',
    }),
  ],
  internalTools: [
    toolDescriptor({
      name: 'load-slack-request',
      description: 'Load the current Slack request context for the runner',
      policy: 'Internal runner bootstrap only.',
      inputSchema: slackRequestIdInputSchema,
    }),
    toolDescriptor({
      name: 'get-tool-catalog',
      description: 'Return the shared tool catalog used by the Codex runner',
      policy: 'Internal runner bootstrap only.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    }),
    toolDescriptor({
      name: 'save-query-answer',
      description: 'Persist a query answer and its diagnostics',
      policy: 'Internal runner persistence only.',
      inputSchema: replyInputSchema,
    }),
    toolDescriptor({
      name: 'save-write-draft',
      description: 'Persist a write draft and its diagnostics',
      policy: 'Internal runner persistence only.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slackRequestId: {
            type: 'string',
          },
          draft: {
            type: 'object',
            additionalProperties: true,
          },
          resultJson: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['slackRequestId', 'draft'],
      },
    }),
    toolDescriptor({
      name: 'save-applied-result',
      description: 'Persist an applied create result and its diagnostics',
      policy: 'Internal runner persistence only.',
      inputSchema: replyInputSchema,
    }),
    toolDescriptor({
      name: 'mark-runner-error',
      description: 'Persist runner failures for the current Slack request',
      policy: 'Internal runner persistence only.',
      inputSchema: errorInputSchema,
    }),
    toolDescriptor({
      name: 'post-slack-reply',
      description: 'Post a Slack reply for the current Slack request',
      policy: 'Internal runner communication only.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slackRequestId: {
            type: 'string',
          },
          reply: {
            type: 'object',
            additionalProperties: true,
          },
          text: {
            type: 'string',
          },
          replaceOriginal: {
            type: 'boolean',
          },
        },
        required: ['slackRequestId'],
      },
    }),
  ],
};

export const getToolCatalog = (): ToolCatalog => TOOL_CATALOG;

export const isEntityKind = (value: string): value is EntityKind =>
  ENTITY_KIND_VALUES.includes(value as EntityKind);
