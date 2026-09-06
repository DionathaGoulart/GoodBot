import { Events } from 'discord.js';

import { defineEvent } from '../lib/event';
import { createInteractionHandler } from '../lib/interaction';

// Um único handler por processo: o store de cooldown precisa sobreviver entre
// interações.
const handler = createInteractionHandler();

export default defineEvent(Events.InteractionCreate, (ctx, interaction) =>
  handler(ctx, interaction),
);
