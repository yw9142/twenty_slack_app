import { describe, expect, it } from 'vitest';

import slackThreadContextObject from 'src/objects/slack-thread-context.object';

const getFieldType = (fieldName: string) =>
  slackThreadContextObject.config.fields.find((field) => field.name === fieldName)
    ?.type;

describe('slack thread context object', () => {
  it('stores thread memory fields as RAW_JSON', () => {
    expect(getFieldType('summaryJson')).toBe('RAW_JSON');
    expect(getFieldType('recentTurnsJson')).toBe('RAW_JSON');
    expect(getFieldType('contextJson')).toBe('RAW_JSON');
    expect(getFieldType('pendingApprovalJson')).toBe('RAW_JSON');
  });

  it('stores reply timestamps as date-time fields', () => {
    expect(getFieldType('lastRepliedAt')).toBe('DATE_TIME');
  });
});
