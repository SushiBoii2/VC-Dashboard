import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import {
    MessageStore,
    SelectedChannelStore,
    UserStore,
    openModal,
    useState
} from "@webpack/common";

import { WorkspaceDashboard } from "./ui/WorkspaceDashboard";
import { readAIConfig, generateReply } from "./services/ai";

function WorkspaceModal(props: { onClose(): void; }) {
    return <WorkspaceDashboard onClose={props.onClose} />;
}

export function openWorkspace(): void {
    openModal((props: any) => <WorkspaceModal onClose={props.onClose} />);
}

function Icon({ height = 20, width = 20 }: { height?: number; width?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 8h8M8 12h5M8 16h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="m16.2 14.8 1.1 1.1 2.1-2.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
}

function getRecentMessages(channelId: string, limit: number): Message[] {
    const collection = MessageStore.getMessages(channelId);
    if (!collection) return [];
    const all = typeof (collection as any).toArray === "function"
        ? (collection as any).toArray()
        : Array.from(collection as any);
    return all
        .filter((message: Message) => Boolean(message?.content?.trim()) && !message.author?.bot)
        .slice(-limit);
}

const AIReplyButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");

    if (!isMainChat) return null;

    const onClick = async () => {
        if (busy) return;
        const channelId = SelectedChannelStore.getChannelId();
        if (!channelId) {
            setStatus("No active channel");
            return;
        }

        const key = sessionStorage.getItem("discord-workspace-ai-key")?.trim();
        if (!key) {
            openWorkspace();
            setStatus("Add an AI API key in Workspace → AI settings");
            return;
        }

        const aiConfig = readAIConfig();
        const messages = getRecentMessages(channelId, aiConfig.messageCount);
        if (!messages.length) {
            setStatus("No recent text messages found");
            return;
        }

        setBusy(true);
        setStatus("Thinking…");
        try {
            const currentUserId = UserStore.getCurrentUser()?.id;
            const context = messages.map(message => ({
                author: message.author?.id === currentUserId
                    ? "You"
                    : (message.author?.globalName || message.author?.username || "Someone"),
                content: message.content.slice(0, 1200)
            }));
            const result = await generateReply(context, aiConfig, key);
            if (!result.shouldReply || !result.reply.trim()) {
                setStatus("No reply needed");
                return;
            }

            // This only inserts text into the composer. It never calls Discord's send action.
            insertTextIntoChatInputBox(result.reply.trim());
            setStatus("Draft inserted — review before sending");
        } catch (error) {
            console.error("[DiscordWorkspace] AI reply failed", error);
            setStatus(error instanceof Error ? error.message : "AI request failed");
        } finally {
            setBusy(false);
            window.setTimeout(() => setStatus(""), 5000);
        }
    };

    return <ChatBarButton
        tooltip={status || (busy ? "Workspace AI is thinking…" : "Draft an AI reply (never sends)")}
        onClick={onClick}
        buttonProps={{ "aria-label": "Draft an AI reply" }}
    >
        <span className="dw-chat-button"><Icon />{busy && <span className="dw-spinner" />}</span>
    </ChatBarButton>;
};

let keyHandler: ((event: KeyboardEvent) => void) | undefined;

export default definePlugin({
    name: "DiscordWorkspace",
    description: "A local-first productivity dashboard with notes, links, tasks and AI drafting.",
    authors: [{ name: "Replace with your name", id: 0n }],
    tags: ["Utility", "Chat"],

    chatBarButton: {
        icon: Icon,
        render: AIReplyButton
    },

    commands: [{
        name: "workspace",
        description: "Open your Discord Workspace dashboard",
        execute: () => {
            openWorkspace();
            return { content: "Opened Discord Workspace." };
        }
    }],

    start() {
        keyHandler = event => {
            if (event.ctrlKey && event.shiftKey && event.code === "KeyW" && !event.repeat) {
                event.preventDefault();
                openWorkspace();
            }
        };
        window.addEventListener("keydown", keyHandler);
    },

    stop() {
        if (keyHandler) window.removeEventListener("keydown", keyHandler);
        keyHandler = undefined;
    }
});
