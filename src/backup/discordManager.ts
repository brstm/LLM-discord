import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  ChannelType,
  BaseGuildTextChannel,
  ThreadChannel,
  Partials,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser
} from "discord.js";
import type { MessageReactionEventDetails } from "discord.js";
import { ephemeralFetchConversation, getUserDisplayName } from "./messageFetch";
import { BotConfig, DMConversationCount } from "./types";
import { callLLM } from "./llmAPI";

/**
 * Initializer and retriever for the stored Discord client for this bot.
 */
let _client: Client | null = null;
function initBotClientAccess(client: Client): void {
  _client = client;
}
export function getBotClient(): Client {
  if (!_client) {
    throw new Error("Discord client not initialized. Call initBotClientAccess first.");
  }
  return _client;
}

// Inline guard stubs � replace with your actual implementations
function shouldAllowBotMessage(message: Message): boolean {
  return true;
}
async function canRespondToChannel(channel: any): Promise<boolean> {
  return true;
}

// Prevent infinite loops in bot-to-bot conversations
interface BotConversationChain {
  chainCount: number;
  lastBotId: string;
  lastActivity: number;
}
const botToBotChains = new Map<string, BotConversationChain>();

// Track active bot instances and DM counts
const activeBots = new Map<string, Client>();
const dmConversationCounts = new Map<string, DMConversationCount>();

// Fantasy-inspired emojis for thumbs-up responses
const responseEmojis = [
        "😎", // Smiley face with sunglasses
        "🧙‍♂️", // Wizard
        "🫡", // Saluting face
        "🔮", // Crystal ball
        "🪄", // Magic wand
        "🧞", // Genie
        "🦸", // Superhero
        "✨", // Sparkles
        "🤩"  // Star-struck face
];

/**
 * Process an incoming message: fetch context, call LLM, and send reply.
 */
async function handleMessageCreate(message: Message) {
  const client = message.client as Client;
  const channel = message.channel;
  const botConfig = client.botConfig!

  if (message.author.bot) {
	if (message.author.id === client.user?.id) return;
    if (!shouldAllowBotMessage(message)) return;
    else botToBotChains.delete(message.channel.id);
  }
  if (!(await canRespondToChannel(message.channel))) return;

  const shouldRespond = await shouldBotRespond(message);
  if (!shouldRespond) return;
  
  // If the bot was @mentioned, reply the same way, unless the bot only ever responds to @mentions
  const shouldPing =
    (
	channel instanceof DMChannel
	|| channel instanceof ThreadChannel
	|| botConfig.replyTo === "name"
	|| botConfig.replyTo === "dynamic"
	)
	&& message.mentions.users.has(client.user!.id);
  
  await processConversation(message, shouldPing);
}

/**
 * Shared conversation processing and LLM call logic.
 */
async function processConversation(message: Message, shouldPing: Boolean) {
  const client = message.client as Client;
  const botConfig = client.botConfig!;
  const channel = message.channel as TextChannel | DMChannel | BaseGuildTextChannel;

  const conversation = await ephemeralFetchConversation(
    channel as TextChannel | DMChannel,
    botConfig.messageLimit,
    5000,
	//  message.id+1
  );
  
  await channel.sendTyping();

  const sessionId = channel instanceof DMChannel ? message.author.id : channel.id;
  const aiResult = await callLLM(botConfig, conversation, sessionId);
  if (aiResult.type === "rate_limited") return;
	
  try {
    if (shouldPing) {
      await message.reply(aiResult.reply);
    } else {
      await channel.send(aiResult.reply);
    }
  } catch (err) {
    console.error(`[Bot ${botConfig.id}] error sending reply:`, err);
    await message.reply(
      "Beep boop, something went wrong. Please contact the owner."
    );
  }
}

/**
 * Determine if the bot should respond to a message based on its configuration.
 */
async function shouldBotRespond(message: Message): Promise<boolean> {
  const client = message.client as Client;
  const botConfig = client.botConfig!;
  
  // If the bot responds dynamically, respond
  if (botConfig.replyTo === "dynamic") return true;
  
  // If this is a DM or a thread with the bot, respond
  if (message.channel instanceof DMChannel 
    || message.channel instanceof ThreadChannel) 
	return true;
  
  // If the bot is @mentioned, respond
  const botId = client.user!.id
  const isMentioned = message.mentions.users.has(botId);
  if (isMentioned) return true;
  
  // If the bot responds to its name, respond if the name is in the message
  const guildId = message.guildId ?? undefined; 
  const botDisplayName = await getUserDisplayName(botId, guildId);
  const textLower = message.content.toLowerCase();
  const nameReferenced = textLower.includes(botDisplayName.toLowerCase());
  if (nameReferenced) return true;
  
  return false;
}

/**
 * Handles the reactionAdd event to respond to reactions on bot messages.
 * @param reaction - The reaction object.
 * @param user - The user who added the reaction.
 * @param _event - Event details (unused in this function).
 */
async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _event: MessageReactionEventDetails
): Promise<void> {

  if (reaction.partial) {
    try {
      reaction = await reaction.fetch();
    } catch (error) {
      console.error("[ReactionAdd] Failed to fetch partial reaction:", error);
      return;
    }
  }
  if (reaction.message.partial) {
    try {
      await reaction.message.fetch();
    } catch (error) {
      console.error("[ReactionAdd] Failed to fetch partial message:", error);
      return;
    }
  }

  // Ensure the message author is the bot itself
  const client = reaction.message.client as Client;
  const botConfig = client.botConfig!;
  if (!reaction.message.author || reaction.message.author.id !== client.user?.id) {
    return; // Ignore reactions on messages not sent by the bot
  }

  // Process the reaction based on the emoji name
  const emojiName = reaction.emoji.name;

  if (emojiName === "👍") {
    console.log(`[ReactionAdd] Received thumbs up emoji.`);
    const randomEmoji = responseEmojis[
      Math.floor(Math.random() * responseEmojis.length)
    ];
    try {
      await reaction.message.react(randomEmoji);
    } catch (err) {
      console.error("[ReactionAdd] Failed to add reaction:", err);
    }
  } else if (emojiName === "👎") {
      console.log(`[ReactionAdd] Received thumbs down emoji.`);
    // Add any logic for thumbs down here if needed
  }
}

/**
 * Create and initialize a Discord client for a given bot configuration.
 */
export async function createDiscordClientForBot(
  botConfig: BotConfig
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
	// Only allow mentions when replying to user
    allowedMentions: { parse: [], repliedUser: true }
  });

  client.once("ready", () => {
    console.log(`Bot [${botConfig.id}] logged in as ${client.user?.tag}`);
    initBotClientAccess(client);
    client.botConfig = botConfig;

    client.on("messageCreate", handleMessageCreate);
    client.on("messageReactionAdd", handleReactionAdd);
    client.on("error", err =>
      console.error(`Bot [${botConfig.id}] WebSocket error:`, err)
    );
  });

  try {
    await client.login(botConfig.discordBotToken);
    activeBots.set(botConfig.id, client);
  } catch (err) {
    console.error(`Failed to login bot ${botConfig.id}:`, err);
    throw err;
  }

  return client;
}

/**
 * Initialize all bots from configurations.
 */
export async function initializeAllBots(
  botConfigs: BotConfig[]
): Promise<Client[]> {
  console.log(`Initializing ${botConfigs.length} bots...`);
  const clients = await Promise.all(
    botConfigs.map(cfg => createDiscordClientForBot(cfg).catch(err => {
      console.error(`Error initializing bot ${cfg.id}:`, err);
      return null as any;
    }))
  );
  return clients.filter((c): c is Client => c !== null);
}

/**
 * Gracefully shutdown all active bots.
 */
export async function shutdownAllBots(): Promise<void> {
  console.log("Shutting down all bots...");
  await Promise.all(
    Array.from(activeBots.values()).map(client =>
      client.destroy().catch(err => console.error(err))
    )
  );
  activeBots.clear();
  dmConversationCounts.clear();
}
