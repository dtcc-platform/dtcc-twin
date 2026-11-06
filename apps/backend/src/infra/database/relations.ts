import { defineRelations } from "drizzle-orm";
import { sessions } from "../../modules/auth/sessions.table.js";
import { chatMessages } from "../../modules/chats/chat-messages.table.js";
import { chatTurns } from "../../modules/chats/chat-turns.table.js";
import { chats } from "../../modules/chats/chats.table.js";
import { items } from "../../modules/items/items.table.js";
import { jobs } from "../../modules/jobs/jobs.table.js";
import { apiKeys } from "../../modules/keys/keys.table.js";
import { savedAreas } from "../../modules/saved-areas/saved-areas.table.js";
import { settings } from "../../modules/settings/settings.table.js";
import { users } from "../../modules/users/users.table.js";

// Add every new table here, even one without relations, or `db.query.<table>` won't exist.
export const relations = defineRelations(
  { users, settings, items, sessions, jobs, apiKeys, savedAreas, chats, chatMessages, chatTurns },
  (r) => ({
    users: {
      settings: r.one.settings({ from: r.users.id, to: r.settings.userId }),
      items: r.many.items(),
      sessions: r.many.sessions(),
      jobs: r.many.jobs(),
      apiKeys: r.many.apiKeys(),
      savedAreas: r.many.savedAreas(),
      chats: r.many.chats(),
      chatTurns: r.many.chatTurns(),
    },
    settings: {
      user: r.one.users({ from: r.settings.userId, to: r.users.id, optional: false }),
    },
    items: {
      user: r.one.users({ from: r.items.userId, to: r.users.id, optional: false }),
    },
    sessions: {
      user: r.one.users({ from: r.sessions.userId, to: r.users.id, optional: false }),
    },
    jobs: {
      user: r.one.users({ from: r.jobs.userId, to: r.users.id, optional: false }),
    },
    apiKeys: {
      user: r.one.users({ from: r.apiKeys.userId, to: r.users.id, optional: false }),
    },
    savedAreas: {
      user: r.one.users({ from: r.savedAreas.userId, to: r.users.id, optional: false }),
    },
    chats: {
      user: r.one.users({ from: r.chats.userId, to: r.users.id, optional: false }),
      messages: r.many.chatMessages(),
      turns: r.many.chatTurns(),
    },
    chatMessages: {
      chat: r.one.chats({ from: r.chatMessages.chatId, to: r.chats.id, optional: false }),
    },
    chatTurns: {
      user: r.one.users({ from: r.chatTurns.userId, to: r.users.id, optional: false }),
      chat: r.one.chats({ from: r.chatTurns.chatId, to: r.chats.id }),
    },
  }),
);
