### Feature: Codex Runner Slack Processing
#### Background / Policy
- Slack ingress stores a `SlackRequest` and hands work off to the runner asynchronously.
- The Codex runner may read CRM context through `/s/tools/*` routes but must not execute CRM writes directly.
- Read-only requests finish as `ANSWERED` and post exactly one Slack thread reply.
- Write requests finish as `AWAITING_CONFIRMATION` and require explicit Slack approval before `apply-approved-draft` executes CRM writes.
- Runner or tool failures must end in `ERROR` with an `errorMessage` persisted on the `SlackRequest`.

#### Scenario 1: Read-only query succeeds
- Given a stored Slack request with `processingStatus = RECEIVED`
- When `process-slack-intake` marks it `PROCESSING` and the runner gathers CRM facts
- Then the runner saves a query answer, posts one Slack reply, and the request ends in `ANSWERED`

#### Scenario 2: Write request requires approval
- Given a stored Slack request that asks to create or update CRM data
- When the runner finishes its reasoning
- Then it stores a `CrmWriteDraft`, moves the request to `AWAITING_CONFIRMATION`, and posts an approval card
- And no CRM write is executed before a later `CONFIRMED` transition

#### Scenario 3: Approval is the only write trigger
- Given a Slack request already holding a saved write draft
- When the request transitions to `CONFIRMED`
- Then `apply-approved-draft` executes the CRM write exactly once
- And no other processing status transition performs the write

#### Scenario 4: Runner handoff or execution fails safely
- Given a stored Slack request with `processingStatus = RECEIVED` or `CLASSIFIED`
- When the handoff to the runner fails or the runner reports a tool/model failure
- Then the request ends in `ERROR`
- And the saved error payload contains `errorMessage` plus diagnostic metadata

#### Scenario 5: Agent tool use stays read-only until finalization
- Given the runner is mid-reasoning on a Slack request
- When Codex requests an intermediate tool call
- Then only read-only CRM lookup tools are allowed
- And state-changing tools such as saving answers, saving drafts, posting replies, or marking errors are executed only by runner control flow after a final decision or failure
