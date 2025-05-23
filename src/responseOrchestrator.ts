import { Client, Message } from "discord.js";
import { ConversationMessage } from "./types";
import { getBotClient } from "./botManager";
import { callLLM } from "./llmAPI";

// Track message cache with proper typing
interface CacheEntry {
	lastFetchTime: number;
	messages: ConversationMessage[];
}

// Cache for display names
interface DisplayNameCacheEntry {
	displayName: string;
	lastFetchTime: number;
}

// In-memory cache for recent message fetches
const channelCache = new Map<string, CacheEntry>();
// Cache for display names - key is guildId:userId
const displayNameCache = new Map<string, DisplayNameCacheEntry>();
const DISPLAY_NAME_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Gets the display name for a user, preferring guild nicknames when in a guild
 * @param userId - Discord user ID
 * @param guildId - Optional Discord guild ID for nickname lookup
 * @returns The most appropriate display name for the user
 */
async function getDisplayName(
	userId: string,
	guildId?: string | null
  ): Promise<string> {
	const client = getBotClient();
	const cacheKey = guildId ? `${guildId}:${userId}` : userId;
	const now = Date.now();
	const cached = displayNameCache.get(cacheKey);
  
	// Return cached value if fresh
	if (cached && now - cached.lastFetchTime < DISPLAY_NAME_CACHE_DURATION) {
	  return cached.displayName;
	}
  
	try {
	  // Always fetch the User object once
	  const user = await client.users.fetch(userId);
	  let displayName: string;
  
	  if (guildId) {
		// Ensure guild is available (cache or fetch)
		const guild =
		  client.guilds.cache.get(guildId) ??
		  (await client.guilds.fetch(guildId));
		const member = await guild.members.fetch(userId);
		// Prefer nickname, then globalName, then username
		displayName = member.nickname ?? user.globalName ?? user.username;
	  } else {
		// No guild context: use globalName or username
		displayName = user.globalName ?? user.username;
	  }
  
	  // Cache the result
	  displayNameCache.set(cacheKey, { displayName, lastFetchTime: now });
  
	  // Prune cache if too big
	  if (displayNameCache.size > 1000) {
		const expiry = now - DISPLAY_NAME_CACHE_DURATION;
		for (const [key, entry] of displayNameCache.entries()) {
		  if (entry.lastFetchTime < expiry) {
			displayNameCache.delete(key);
		  }
		}
	  }
  
	  return displayName;
	} catch (error) {
		const e = error as Error;
	  console.warn("Could not get display name, falling back to username.", e.name, e.message);
	  // Final fallback: fetch user and return name
	  const user = await client.users.fetch(userId);
	  return user.globalName ?? user.username;
	}
  }
 
/**
 * Fetches conversation from Discord channel
 * @param message - The Discord message
 * @param limit - Number of messages to fetch before and including this message
 * @returns Array of formatted messages
 */
async function fetchConversationFromDiscord(
	message: Message,
	limit: number
): Promise<ConversationMessage[]> {
	// Fetch messages from Discord
	const client = message.client as Client;
	const botId = client.user?.id;
	const channel = message.channel;
	const before = message.id;
	const fetched = limit ? await channel.messages.fetch({ limit, before }) : null;

	// Check if fetched exists, otherwise make sorted an empty array
	const sorted = fetched
		// Sort messages chronologically (oldest first)
		? Array.from(fetched.values()).sort(
			(a, b) => a.createdTimestamp - b.createdTimestamp)
		: [];
	// If the message was from a user, include it
	if (message.author.id !== botId)
		sorted.push(message);

	// Pre-fetch display names for all users
	const userIds = Array.from(new Set(sorted.map(msg => msg.author.id)));
	const guildId = !channel.isDMBased() ? channel.guildId : undefined;
	const displayNames = await Promise.all(
		userIds.map(userId => getDisplayName(userId, guildId))
	);
	const nameMap = new Map<string, string>(
		userIds.map((userId, i) => [userId, displayNames[i]])
	);

	// Replace mentions with display names
	const mentionRegex = /<@!?(\d+)>/g;
	const replaceMentions = (text: string) =>
		text.replace(mentionRegex, (_, matchedUserId) =>
			nameMap.get(matchedUserId) ?? `<@${matchedUserId}>`
		);

	// Format messages using cached display names
	const messages: ConversationMessage[] = sorted.map(msg => ({
		timestamp: msg.createdAt.toISOString(),
		username: nameMap.get(msg.author.id) ?? msg.author.username,
		text:
			replaceMentions(msg.content || "") +
			(msg.embeds?.length
				? " " +
				msg.embeds
					.map(e => [e.title, e.description].filter(Boolean).join(" "))
					.join(" ")
				: ""),
	}));

	// If there's a channel topic, include it at the top as additional context	
	if (('topic' in channel) && channel.topic) {
		messages.unshift({
			timestamp: new Date().toISOString(),
			username: "Channel Topic",
			text: (channel as any).topic,
		});
	}

	return messages;
}


/**
 * Fetches conversation with caching support
 * @param message - The Discord message
 * @param limit - Number of messages to fetch before and including this message
 * @param cacheDurationMs - How long to cache messages
 */
async function ephemeralFetchConversation(
	message: Message,
	limit: number,
	cacheDurationMs: number = 5000
): Promise<ConversationMessage[]> {
	const now = Date.now();
	const channel = message.channel;
	const cacheKey = channel.id;
	const cached = channelCache.get(cacheKey);

	// Return cached data if it's fresh
	if (cached && now - cached.lastFetchTime < cacheDurationMs) {
		return cached.messages;
	}

	// Fetch new data
	const messages = await fetchConversationFromDiscord(message, limit);

	// Update cache
	channelCache.set(cacheKey, {
		lastFetchTime: now,
		messages,
	});

	// Clean old cache entries periodically
	if (channelCache.size > 1000) {
		// Prevent unbounded growth
		const oldestAllowed = now - cacheDurationMs;
		for (const [key, value] of channelCache.entries()) {
			if (value.lastFetchTime < oldestAllowed) {
				channelCache.delete(key);
			}
		}
	}

	return messages;
}

/**
 * Shared conversation processing and LLM call logic.
 */
async function processConversation(message: Message, respondAsReply: Boolean) {
	if (!message.channel.isSendable()) return;
		
	const client = message.client as Client;
	const botConfig = client.botConfig!;
	const botId = client.user!.id;
	const channel = message.channel;
	
	const conversation = await ephemeralFetchConversation(
		message,
		botConfig.convLength,
		5000
	);

	// Show typing and refresh every 8 seconds
	await channel.sendTyping();
	const typingInterval = setInterval(() => {
	channel.sendTyping().catch(console.error);
	}, 8000);

	// If the triggering message is a bot message, try to find the original user message
	let userMessage: Message | null = null;
	if (message.author.id !== botId) {
		userMessage = message;
	} else {
		try {
			// If the message has a reference, use that
			if (message.reference?.messageId) {
				userMessage = channel.messages.cache.get(message.reference.messageId)
					?? await message.fetchReference().catch(() => null); // assign null if there was an error getting the reference
			}
			// If the references was invalid or there is no reference, get the preceeding message
			if (!userMessage)
				userMessage = (await channel.messages.fetch({ before: message.id, limit: 1 })).first()!;
			// If that doesn't work, we bail out.
			if (!userMessage)
				throw new Error("No user message found.");
		} catch (err) {
			console.error("Failed to fetch referenced or preceding message:", err);
			return;
		}
	}

	// Encode the session ID as bot, user, and channel
	const sessionData = {
		botId,
		botName: await getDisplayName(botId, message.guildId),
		userId: userMessage.author.id,
		channelId: channel.isThread()
			? channel.parentId
			: channel.id
	};
	const sessionId = Buffer
		.from(JSON.stringify(sessionData))
		.toString('base64');
	const aiResult = await callLLM(botConfig, conversation, sessionId);
	if (aiResult.type === "rate_limited") return;

	try {
		if (respondAsReply) {
			await userMessage.reply(aiResult.reply);
		} else {
			await channel.send(aiResult.reply);
		}
	} catch (err) {
		console.error(`[Bot ${botConfig.id}] error sending reply:`, err);
		await userMessage.reply(
			"Beep boop, something went wrong. Please contact the owner."
		);
	} finally {
		clearInterval(typingInterval);	
	}
}

export { getDisplayName, processConversation };