import slackIntakeObject from 'src/objects/slack-intake.object';
import { describe, expect, it } from 'vitest';

const getFieldType = (fieldName: string) =>
  slackIntakeObject.config.fields.find((field) => field.name === fieldName)?.type;

describe('slack intake object', () => {
  it('stores confidence as a numeric field', () => {
    expect(getFieldType('confidence')).toBe('NUMBER');
  });

  it('stores processing timestamps as date-time fields', () => {
    expect(getFieldType('receivedAt')).toBe('DATE_TIME');
    expect(getFieldType('lastProcessedAt')).toBe('DATE_TIME');
  });
});
