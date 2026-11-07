export interface AIConfig {
    endpoint: string;
    model: string;
    messageCount: number;
    temperature: number;
}

export interface ChatContextMessage {
    author: string;
    content: string;
}

export interface ReplyDecision {
    shouldReply: boolean;
    reply: string;
}

const CONFIG_KEY = "discord-workspace-ai-config-v1";
export const DEFAULT_AI_CONFIG: AIConfig = {
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    messageCount: 8,
    temperature: 0.55
};

export function readAIConfig(): AIConfig {
    try {
        const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
        return { ...DEFAULT_AI_CONFIG, ...saved };
    } catch {
        return DEFAULT_AI_CONFIG;
    }
}

export function writeAIConfig(config: AIConfig): void {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function parseDecision(raw: string): ReplyDecision {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
        const parsed = JSON.parse(cleaned);
        return {
            shouldReply: parsed.should_reply === true,
            reply: typeof parsed.reply === "string" ? parsed.reply : ""
        };
    } catch {
        if (/^\s*(NO_REPLY|NONE|SKIP)\s*$/i.test(cleaned)) return { shouldReply: false, reply: "" };
        throw new Error("The AI returned an unreadable reply decision. Try again or use another model.");
    }
}

export async function generateReply(
    context: ChatContextMessage[],
    config: AIConfig,
    apiKey: string
): Promise<ReplyDecision> {
    const endpoint = config.endpoint.trim().replace(/\/+$/, "");
    if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/localhost(?::\d+)?/i.test(endpoint)) {
        throw new Error("Use HTTPS for remote AI endpoints (localhost is allowed for local models).");
    }

    const transcript = context.slice(-Math.max(1, Math.min(config.messageCount, 30)))
        .map(message => `${message.author}: ${message.content}`)
        .join("\n");

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: config.model,
            temperature: config.temperature,
            max_tokens: 220,
            messages: [
                {
                    role: "system",
                    content: [
                        "You are a context-aware drafting assistant for a Discord user.",
                        "Decide whether the user should reply to the recent conversation.",
                        "Do not reply when the conversation does not call for a response, the user has already answered, the messages are just casual ongoing chatter where no response is needed, or the context is insufficient.",
                        "If a reply is warranted, write one concise, natural draft in the user's voice, based only on the supplied context.",
                        "Never invent personal experiences, promises, facts, or commitments for the user.",
                        "Return ONLY valid JSON with exactly these fields: {\"should_reply\": boolean, \"reply\": string}.",
                        "When no reply is needed, return {\"should_reply\": false, \"reply\": \"\"}."
                    ].join(" ")
                },
                {
                    role: "user",
                    content: `Recent conversation (oldest first):\n${transcript}\n\nShould I reply? Return the required JSON decision.`
                }
            ]
        }),
        signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`AI provider returned ${response.status}: ${detail || response.statusText}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("AI provider returned no message content.");
    return parseDecision(raw);
}
