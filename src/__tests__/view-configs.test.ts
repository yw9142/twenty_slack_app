import slackRequestApprovalView from 'src/views/slack-request-approval.view';
import slackRequestErrorView from 'src/views/slack-request-error.view';
import slackRequestQueryView from 'src/views/slack-request-query.view';
import slackRequestWriteView from 'src/views/slack-request-write.view';
import { describe, expect, it } from 'vitest';

const secondaryViews = [
  slackRequestApprovalView,
  slackRequestErrorView,
  slackRequestQueryView,
  slackRequestWriteView,
];

describe('slack request views', () => {
  it('declares secondary views as table views', () => {
    for (const view of secondaryViews) {
      expect(view.config.type).toBe('TABLE');
    }
  });
});
