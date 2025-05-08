import { BaseMessageOptions } from "discord.js";

declare module "discord.js" {
	interface Client {
		/** Populated in createDiscordClientForBot */
		botConfig?: BotConfig;
	}
}

export interface BotConfig {
	id: string;
	discordBotToken: string;
	inferUrl: string;
	apiKey?: string;
	sessionHeaderName?: string;
	convLength: number;
	respondTo?: string;
	respondAsReply: boolean;
	customFields?: Record<string, any>;
}

export interface ConversationMessage {
	username: string;
	text: string;
	timestamp?: string;
}

export interface LLMResponse {
	success: boolean;
	reply: string | BaseMessageOptions;
	stop_reason?: string | null;
	error?: string;
}

export interface DMConversationCount {
	count: number;
	lastMessageTime: number;
}

export type LLMResult =
	| {
		type: "success";
		reply: BaseMessageOptions;
	}
	| {
		type: "rate_limited";
	};
