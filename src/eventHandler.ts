import {
	Client,
	Message,
	MessageType,
	MessageReaction,
	PartialMessageReaction,
	PermissionFlagsBits,
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
 * Unified helper: decides if bot should respond to a message,
 * including loop prevention and permission checks.
 */
async function shouldRespond(message: Message): Promise<boolean> {
	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;
	const channel = message.channel;

	// Only respond to standard messages
	if (message.type !== MessageType.Default
		&& message.type !== MessageType.Reply)
		return false;

	// Protect against bot loops
	if (message.author.bot) {
		if (message.author.id === botId) return false;
		const chain = botToBotChains.get(channel.id) ?? { chainCount: 0, lastBotId: "", lastActivity: 0 };
		const now = Date.now();
		if (now - chain.lastActivity > 600_000) {
			chain.chainCount = 0;
			chain.lastBotId = "";
		}
		if (chain.lastBotId && chain.lastBotId !== message.author.id) chain.chainCount++;
		chain.lastBotId = message.author.id;
		chain.lastActivity = now;
		botToBotChains.set(channel.id, chain);
		if (chain.chainCount >= 3) return false;
	}

	// Check channel permissions, where appropriate
	if (!channel.isDMBased()) {
		const perms = channel.permissionsFor(client.user!);
		if (!perms) return false;
		const required = [
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.SendMessages,
			PermissionFlagsBits.ReadMessageHistory,
		];
		if (!perms.has(required)) return false;
	}

	// Check if there are non-bot mentions in the thread
	// If the bot is not also mentioned, ignore the message
	const { users, roles, channels, everyone } = message.mentions;
	const hasAnyMention =
		everyone ||
		users.size > 0 ||
		roles.size > 0 ||
		channels.size > 0;
	const isBotMentioned = users.has(botId);
	if (hasAnyMention && !isBotMentioned) return false;

	// If this is a thread, reply only if the bot is a member and has permissions
	if (channel.isThread()) {
		if (channel.sendable && channel.joined)
			return true;
		return false;
	}

	// Always-respond when:
	if (botConfig.respondTo === "dynamic"
		|| channel.isDMBased()
		|| isBotMentioned
	) return true;

	// If the bot should reply to its name
	if (botConfig.respondTo === "name") {
		const displayName = (await getDisplayName(botId, message.guildId)).toLowerCase();
		if (message.content.toLowerCase().includes(displayName)) return true;
	}

	return false;
}

/**
 * Message handler: initiate response when appropriate
 */
async function handleMessageCreate(message: Message) {
	// Validate if the bot should respond to this message
	if (!(await shouldRespond(message))) return;

	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;
	const channel = message.channel;

	// Determine if the bot should reply, or just respond normally
	const respondAsReply =
		// If the bot was mentioned, always reply
		message.mentions.users.has(botId)
		// Otherwise, only reply if the bot is set to respondAsReply and this isn't a DM or thread
		|| (botConfig.respondAsReply && !(channel.isDMBased() || channel.isThread()));

	await processConversation(message, respondAsReply);
}

/**
 * Reaction handler: add emoji or regenerate response on thumbs down
 */
async function handleReactionAdd(
	reaction: MessageReaction | PartialMessageReaction
): Promise<void> {
	// Resolve partial reactions
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

	// If we have a full reaction, proceed
	const message = reaction.message as Message;
	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;
	
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
	
	// Only process reactions on the bot's messages
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