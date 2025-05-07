import dotenv from "dotenv";
import { initializeAllBots, shutdownAllBots } from "./discordManager";
import { BotConfig } from "./types";

dotenv.config();

/**
 * Load bot configurations from environment variables
 * Looks for pairs of AI_CODE_N and DISCORD_BOT_TOKEN_N where N starts from 1
 * @returns Array of bot configurations
 */
function loadBotConfig(id: string): BotConfig {
  const prefix = `${id}_`;

  return {
    id,
    discordBotToken: process.env[`${prefix}DISCORD_BOT_TOKEN`]!,
    inferUrl: process.env[`${prefix}LLM_INFER_URL`]!,
    apiKey: process.env[`${prefix}LLM_API_KEY`]!,
	replyTo: process.env[`${prefix}REPLY_TO`]?.toLowerCase(),
    messageLimit: Math.max(1, parseInt(process.env[`${prefix}CONVERSATION_LENGTH`] || '1', 10)),
    sessionHeaderName: process.env[`${prefix}SESSION_HEADER`],
    customFields: (() => {
      try {
        const raw = process.env[`${prefix}CUSTOM_FIELDS_JSON`];
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        console.warn(`Invalid JSON in ${prefix}CUSTOM_FIELDS_JSON`);
        return {};
      }
    })(),
  };
}

function getAllBotIds(): string[] {
  return Object.keys(process.env)
    .filter(key => key.endsWith('_DISCORD_BOT_TOKEN'))
    .map(key => key.split('_')[0]);
}

async function main(): Promise<void> {
  try {
    // Load bot configurations
	const botIds = getAllBotIds(); 
	const botConfigs = []; // Initialize an empty array to store configurations

	for (const botId of botIds) {
		const config = loadBotConfig(botId); // Load configuration for each botId
		botConfigs.push(config); // Add the result to botConfigs
	}

    if (botConfigs.length === 0) {
      console.error(
        "No valid bot configurations found in environment variables"
      );
      process.exit(1);
    }

    console.log(`Found ${botConfigs.length} bot configurations`);

    // Initialize all bots
    await initializeAllBots(botConfigs);

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT. Shutting down...");
      await shutdownAllBots();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("\nReceived SIGTERM. Shutting down...");
      await shutdownAllBots();
      process.exit(0);
    });
  } catch (error) {
    console.error("Fatal error during initialization:", error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
