import {
  type DatabaseEventPayload,
  type ObjectRecordCreateEvent,
} from 'twenty-sdk';

import { NOTE_STRUCTURING_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { structureNoteIntoTasks } from 'src/utils/crm-automations';
import { defineLogicFunction } from 'src/utils/define-logic-function';

const handler = async (
  event: DatabaseEventPayload<ObjectRecordCreateEvent<Record<string, unknown>>>,
): Promise<Record<string, unknown>> =>
  structureNoteIntoTasks({
    noteId: event.recordId,
  });

export default defineLogicFunction({
  universalIdentifier: NOTE_STRUCTURING_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'note-structuring',
  description: 'Creates follow-up tasks from note content when notes are added',
  timeoutSeconds: 20,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'note.created',
  },
});
