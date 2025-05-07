import {
	Client,
	GatewayIntentBits,
	Partials
} from "discord.js";
import { BotConfig, DMConversationCount } from "./types";
import { handleMessageCreate, handleReactionAdd } from "./eventHandler";

let _client: Client | null = null;

/**
 * Set global access to the bot's Discord client.
 */
export function initBotClientAccess(client: Client): void {
	_client = client;
}
export function getBotClient(): Client {
	if (!_client) {
		throw new Error("Discord client not initialized. Call initBotClientAccess first.");
	}
	return _client;
}

// Track active bot instances and DM counts
const activeBots = new Map<string, Client>();
const dmConversationCounts = new Map<string, DMConversationCount>();

/**
 * Create and initialize a Discord client for a given bot configuration.
 */
export async function createDiscordClientForBot(botConfig: BotConfig): Promise<Client> {
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
		// Do not allow mentions
		allowedMentions: { parse: [], repliedUser: false }
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
export async function initializeAllBots(botConfigs: BotConfig[]): Promise<Client[]> {
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