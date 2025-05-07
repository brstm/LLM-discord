import { Client, MessageOptions } from "discord.js";

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
  messageLimit: number;
  replyTo?: string;
  apiKey?: string;
  sessionHeaderName?: string; 
  customFields?: Record<string, any>;
}

export interface ConversationMessage {
  username: string;
  text: string;
  timestamp?: string;
}

export interface LLMResponse {
  success: boolean;
  reply: string | MessageOptions;
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
      reply: MessageOptions;
    }
  | {
      type: "rate_limited";
    };
