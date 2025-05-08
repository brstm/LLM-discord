import axios, { AxiosError } from "axios";
import {
	BotConfig,
	ConversationMessage,
	LLMResponse,
	LLMResult,
} from "./types";

// Function to parse out various kinds of LLM response types
//
function parseLLMResponse(data: LLMResponse): LLMResult {
	// If there's no `success` flag at all, assume the entire body _is_ the raw reply
	if (data.success === undefined) {
		// If it's already a string, use it; otherwise stringify the object
		const content =
			typeof data === "string"
				? data
				: JSON.stringify(data, null, 2);
		return { type: "success", reply: { content } };
	}

	// Explicit failure
	if (!data.success) {
		throw new Error(data.error ?? "API request failed");
	}

	// Success — pull out `data.reply`
	const { reply } = data;

	return {
		type: "success",
		// if reply is a string, wrap it; else pass through embeds/content object
		reply:
			typeof reply === "string" ? { content: reply } : (reply as any),
	};
}

/**
 * Calls the LLM inference endpoint
 * @param botConfig - configuration options for this bot
 * @param conversation - array of conversation messages
 * @param sessionId - unique identifier for this conversation
 * @returns LLMResult indicating success with reply or rate limit
 * @throws Error if the API call fails (except for rate limits)
 */
export async function callLLM(
	botConfig: BotConfig,
	conversation: ConversationMessage[],
	sessionId: string
): Promise<LLMResult> {
	try {
		if (conversation.length === 0) {
			throw new Error("Conversation array cannot be empty");
		}

		// If this bot is set for no conversation history, send just a single message as 'message'
		// Otherwise send the whole conversation
		const requestBody = !botConfig.convLength
			? { message: conversation[0].text, ...botConfig.customFields }
			: { conversation, ...botConfig.customFields };

		const response = await axios.post<LLMResponse>(
			botConfig.inferUrl,
			requestBody,
			{
				headers: {
					Authorization: `Bearer ${botConfig.apiKey}`,
					"Content-Type": "application/json",
					...(botConfig.sessionHeaderName && { [botConfig.sessionHeaderName]: sessionId }) // Dynamic session header
				}
			}
		);

		// Non-200 statuses are failures
		if (response.status !== 200) {
			throw new Error(`Request failed with status code ${response.status}`);
		}
		return parseLLMResponse(response.data);

	} catch (error) {
		console.error("Error calling LLM:", (error as Error).message);
		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError<LLMResponse>;
			if (axiosError.response) {
				console.error("Response data:", axiosError.response.data);
				console.error("Response status:", axiosError.response.status);
				if (axiosError.response.status === 429) {
					return { type: "rate_limited" };
				}
				if (axiosError.response.data?.error) {
					throw new Error(axiosError.response.data.error);
				}
			}
		}
		throw new Error("Failed to get response from LLM");
	}
}
