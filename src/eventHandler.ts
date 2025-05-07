import {
	Client,
	Message,
	DMChannel,
	ThreadChannel,
	BaseGuildTextChannel,
	PermissionFlagsBits,
	MessageReactionEventDetails,
	MessageReaction,
	PartialMessageReaction,
	User,
	PartialUser,
} from "discord.js";
import { processConversation, getDisplayName } from "./responseOrchestrator";

// Prevent infinite loops in bot-to-bot conversations
interface BotConversationChain {
	chainCount: number;
	lastBotId: string;
	lastActivity: number;
}
const botToBotChains = new Map<string, BotConversationChain>();

/**
 * Unified helper: decides if bot should process a message,
 * including loop prevention and permission checks.
 */
async function shouldRespond(message: Message): Promise<boolean> {
	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;

	// Bot-to-bot loop guard
	if (message.author.bot) {
		if (message.author.id === botId) return false;
		const channelId = message.channel.id;
		const chain = botToBotChains.get(channelId) ?? { chainCount: 0, lastBotId: "", lastActivity: 0 };
		const now = Date.now();
		if (now - chain.lastActivity > 600_000) {
			chain.chainCount = 0;
			chain.lastBotId = "";
		}
		if (chain.lastBotId && chain.lastBotId !== message.author.id) chain.chainCount++;
		chain.lastBotId = message.author.id;
		chain.lastActivity = now;
		botToBotChains.set(channelId, chain);
		if (chain.chainCount >= 3) return false;
	}

	// Permission guard (skip DM)
	if (!(message.channel instanceof DMChannel)) {
		const guildChannel = message.channel as BaseGuildTextChannel;
		const perms = guildChannel.permissionsFor(client.user!);
		if (!perms) return false;
		const required = [
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.SendMessages,
			PermissionFlagsBits.ReadMessageHistory,
			...(guildChannel instanceof ThreadChannel
				? [PermissionFlagsBits.SendMessagesInThreads]
				: []),
		];
		if (!perms.has(required)) return false;
	}

	// Always-respond setting
	if (botConfig.respondTo === "dynamic") return true;

	// Check if this is a DM or thread
	if (
		message.channel instanceof DMChannel ||
		message.channel instanceof ThreadChannel
	) {
		return true;
	}

	// Check if the bot was mentioned
	if (message.mentions.users.has(botId)) return true;

	// Check if the message has the bot's display name
	const displayName = (await getDisplayName(botId, message.guildId)).toLowerCase();
	if (message.content.toLowerCase().includes(displayName)) return true;

	return false;
}

/**
 * Entry: handle new message events
 */
async function handleMessageCreate(message: Message) {
	if (!(await shouldRespond(message))) return;
	// Ensure channel supports send/sendTyping
	const channel = message.channel;
	if (
		!(channel instanceof DMChannel) &&
		!(channel instanceof BaseGuildTextChannel)
	)
		return;

	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;

	const isDMorThread =
		channel instanceof DMChannel || channel instanceof ThreadChannel;
	const respondAsReply =
		(botConfig.respondAsReply && !isDMorThread) ||
		message.mentions.users.has(botId) ||
		isDMorThread;

	await processConversation(message, respondAsReply);
}

// Fantasy-inspired emojis for thumbs-up responses
const responseEmojis = [
	"😎",
	"🧙‍♂️",
	"🫡",
	"🔮",
	"🪄",
	"🧞",
	"🦸",
	"✨",
	"🤩",
];

/**
 * Reaction handler: add emoji or regenerate response on thumbs down
 */
async function handleReactionAdd(
	reaction: MessageReaction | PartialMessageReaction,
	user: User | PartialUser,
	_event: MessageReactionEventDetails
): Promise<void> {
	if (reaction.partial) {
		try {
			reaction = await reaction.fetch();
		} catch {
			return;
		}
	}
	if (reaction.message.partial) {
		try {
			await reaction.message.fetch();
		} catch {
			return;
		}
	}

	const message = reaction.message as Message;
	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;
	if (!message.author || message.author.id !== botId) return;

	const emojiName = reaction.emoji.name;
	if (emojiName === "👍") {
		if (message.reactions.cache.some((r) => r.users.cache.has(botId))) return;
		const randomEmoji =
			responseEmojis[Math.floor(Math.random() * responseEmojis.length)];
		try {
			await message.react(randomEmoji);
		} catch { }
	} else if (emojiName === "👎") {
		try {
			await processConversation(message, true);
			message.delete();
		} catch { }
	}
}

export { handleMessageCreate, handleReactionAdd };
