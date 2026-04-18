### Feature: slack-thread-memory
#### Background / Policy
- Memory is isolated by `slackTeamId + slackChannelId + slackThreadTs`.
- `SlackRequest` remains the per-message audit log.
- `slackThreadContext` is the conversational source of truth for the same Slack thread.
- Query answers are posted immediately.
- Create actions are applied immediately.
- Update and delete actions remain approval-gated.
- Only one pending approval is active per thread.

#### Scenario 1: Same-thread query follow-up reuses prior entity context
- Given a Slack thread previously queried `미래금융` opportunities
- And the thread context stores the selected opportunity ids and recent query snapshot
- When the next Slack message says `그거 단계만 알려줘`
- Then the runner loads the same thread context before tool selection
- And the prompt includes recent turns, summary, selected entities, and pending approval
- And the response can resolve `그거` without re-reading the full Slack history

#### Scenario 2: Broad query still persists memory for later turns
- Given a Slack thread asks for `영업기회 조회좀 해줘`
- When the runner performs a search tool call and saves the final query answer
- Then the answer is persisted on `SlackRequest`
- And the thread context stores the assistant turn, summary, selected entities, and last query snapshot
- And any existing pending approval in the same thread is preserved

#### Scenario 3: Update/delete draft replaces active pending approval
- Given a Slack thread already has one pending update approval
- When the next Slack message creates a new update or delete draft in the same thread
- Then the new draft is saved on the new `SlackRequest`
- And the thread context replaces the active pending approval with the latest draft
- And the old draft remains only in the original audit log

#### Scenario 4: Approval or rejection clears stale pending approval
- Given a Slack thread has an active pending approval
- When the request is applied successfully
- Then the thread context clears the pending approval
- And the assistant turn records the applied outcome
- When the request is rejected
- Then the thread context clears the pending approval for that request
- And the assistant turn records the rejection outcome

#### Scenario 5: Different Slack threads never share memory
- Given two Slack threads in the same channel
- When each thread sends follow-up messages
- Then each thread loads only its own `slackThreadContext`
- And selected entities, summaries, and pending approvals never leak across threads
