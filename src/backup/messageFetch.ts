import { TextChannel, DMChannel, Client, Message } from "discord.js";
import { ConversationMessage } from "./types";
import { getBotClient } from "./discordManager";

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
 * Gets the display name for a message author with proper member fetching
 * @param userId - Discord user id
 * @param guildId - Discord guild id (if available) for guild nickname
 * @returns The most appropriate display name
 */
async function getUserDisplayName(userId: string, guildId?: string): Promise<string> {
  // Alias client for non-nullable access
  const client = getBotClient();

  // Create a cache key which is guild-specific if provided
  const cacheKey = guildId ? `${guildId}:${userId}` : userId;
  const now = Date.now();
  const cached = displayNameCache.get(cacheKey);

  // Return cached name if still valid
  if (cached && now - cached.lastFetchTime < DISPLAY_NAME_CACHE_DURATION) {
    return cached.displayName;
  }

  let displayName: string;

  try {
    if (guildId) {
      // Attempt to get the guild from the cache
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error("Guild not found in cache");
      }

      // Fetch the member information in this guild
      const member = await guild.members.fetch(userId);
      if (member.nickname) {
        displayName = member.nickname;
      } else {
        // Fallback to global user info
        const user = await client.users.fetch(userId);
        displayName = user.globalName || user.username;
      }
    } else {
      // Fetch global user info when no guild provided
      const user = await client.users.fetch(userId);
      displayName = user.globalName || user.username;
    }

    // Update the cache with the fetched displayName
    displayNameCache.set(cacheKey, {
      displayName,
      lastFetchTime: now
    });

    // Prune old cache entries if the cache grows too large
    if (displayNameCache.size > 1000) {
      const oldestAllowed = now - DISPLAY_NAME_CACHE_DURATION;
      for (const [key, value] of displayNameCache.entries()) {
        if (value.lastFetchTime < oldestAllowed) {
          displayNameCache.delete(key);
        }
      }
    }

    return displayName;
  } catch (error) {
    console.error("Error getting display name:", error);
    // If an error occurs, try one final time to retrieve the global username
    const user = await client.users.fetch(userId);
    return user.globalName || user.username;
  }
}

/**
 * Fetches conversation from Discord channel
 * @param channel - The Discord channel to fetch from
 * @param limit - Number of messages to fetch
 * @returns Array of formatted messages
 */
async function fetchConversationFromDiscord(
  channel: TextChannel | DMChannel,
  limit: number,
  before?: string
): Promise<ConversationMessage[]> {
	// Fetch messages from Discord
	const fetched = await channel.messages.fetch({ limit, before });
	
	// Sort messages chronologically (oldest first)
	const sorted = Array.from(fetched.values()).sort(
		(a, b) => a.createdTimestamp - b.createdTimestamp
	 );

    // Pre-fetch display names for all users
	const userIds = Array.from(new Set(sorted.map(msg => msg.author.id)));
	const guildId = channel instanceof TextChannel
		? channel.guildId
		: undefined;
	const displayNames = await Promise.all(
		userIds.map(userId => getUserDisplayName(userId, guildId))
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
	if (channel instanceof TextChannel && channel.topic) {
		messages.unshift({
			timestamp: new Date().toISOString(),
			username: "Channel Topic",
			text: channel.topic,
		});
	}

	return messages;
}


/**
 * Fetches conversation with caching support
 * @param channel - The Discord channel
 * @param limit - Number of messages to fetch
 * @param cacheDurationMs - How long to cache messages
 */
async function ephemeralFetchConversation(
  channel: TextChannel | DMChannel,
  limit: number,
  cacheDurationMs: number = 5000,
  before?: string
): Promise<ConversationMessage[]> {
  const now = Date.now();
  const cacheKey = channel.id;
  const cached = channelCache.get(cacheKey);

  // Return cached data if it's fresh
  if (cached && now - cached.lastFetchTime < cacheDurationMs) {
    return cached.messages;
  }

  // Fetch new data
  const messages = await fetchConversationFromDiscord(channel, limit, before);

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

export { getUserDisplayName, ephemeralFetchConversation };
