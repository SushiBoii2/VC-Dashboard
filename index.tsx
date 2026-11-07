/*
 * VC Dashboard — private Vencord userplugin
 * Place this folder at src/userplugins/vcDashboard in a Vencord source checkout.
 */

import { React } from "@webpack/common";
import definePlugin from "@utils/types";
import { SelectedChannelStore, MessageStore, UserStore } from "@webpack/common";

const DB_NAME = "vc-dashboard-workspace";
const DB_VERSION = 1;
const STORE = "records";
const SETTINGS_KEY = "vc-dashboard-settings-v1";

type RecordKind = "note" | "link" | "clip" | "file";
type WorkspaceRecord = {
    id: string;
    kind: RecordKind;
    title: string;
    body: string;
    createdAt: number;
    updatedAt: number;
    fileData?: string;
    fileName?: string;
};
type AISettings = {
    provider: "nvidia" | "local";
    endpoint: string;
    model: string;
    apiKey: string;
    contextCount: number;
    style: string;
};

type DraftResult = { should_reply: boolean; reason?: string; reply?: string };

const DEFAULT_AI: AISettings = {
    provider: "nvidia",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: "meta/llama-3.1-70b-instruct",
    apiKey: "",
    contextCount: 10,
    style: "Natural, concise, friendly. Match the conversation without sounding robotic."
};

let dbPromise: Promise<IDBDatabase> | undefined;
function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    return dbPromise;
}

async function getAllRecords(): Promise<WorkspaceRecord[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as WorkspaceRecord[]).sort((a, b) => b.updatedAt - a.updatedAt));
        req.onerror = () => reject(req.error);
    });
}
async function putRecord(record: WorkspaceRecord) {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function deleteRecord(id: string) {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
function loadAISettings(): AISettings {
    try { return { ...DEFAULT_AI, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
    catch { return { ...DEFAULT_AI }; }
}
function saveAISettings(settings: AISettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function makeId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }

function getRecentConversation(count: number) {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) return { channelId: "", messages: [] as Array<{ author: string; content: string }> };
    const collection = MessageStore.getMessages(channelId);
    const raw = collection?.toArray?.() ?? [];
    const currentUserId = UserStore.getCurrentUser()?.id;
    const messages = raw.slice(-count).map((message: any) => ({
        author: message.author?.username || (message.author?.id === currentUserId ? "You" : "Unknown"),
        content: String(message.content || "").slice(0, 3000)
    })).filter((message: { content: string }) => message.content.trim());
    return { channelId, messages };
}

async function requestDraft(settings: AISettings, messages: Array<{ author: string; content: string }>): Promise<DraftResult> {
    if (!settings.endpoint.trim() || !settings.model.trim()) throw new Error("Configure an AI endpoint and model in Workspace → Settings.");
    if (settings.provider === "nvidia" && !settings.apiKey.trim()) throw new Error("Add your NVIDIA API key in Workspace → Settings.");
    const systemPrompt = [
        "You are a Discord conversation drafting assistant.",
        "Decide whether the current user (You) should send a reply based only on the supplied recent conversation.",
        "Do not force a reply. If the conversation does not call for a response, set should_reply to false.",
        "Never invent facts about the user. Do not claim the user did something unless the context says so.",
        `Writing style: ${settings.style}`,
        "Return ONLY valid JSON with this schema: {\"should_reply\": boolean, \"reason\": string, \"reply\": string}.",
        "If should_reply is false, reply must be an empty string. Keep the draft suitable for the existing conversation."
    ].join("\n");
    const response = await fetch(settings.endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
            model: settings.model,
            temperature: 0.6,
            max_tokens: 350,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Recent Discord messages (oldest first):\n${messages.map(m => `${m.author}: ${m.content}`).join("\n")}` }
            ]
        })
    });
    if (!response.ok) throw new Error(`AI request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("The AI provider returned an unexpected response.");
    const jsonText = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonText);
    return {
        should_reply: Boolean(parsed.should_reply),
        reason: String(parsed.reason || ""),
        reply: String(parsed.reply || "").trim()
    };
}

function insertIntoComposer(text: string) {
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"][data-slate-editor="true"]')
        || document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]');
    if (!editor) throw new Error("Couldn't find Discord's message editor. Click the message box and try again.");
    editor.focus();
    const selection = window.getSelection();
    if (!selection || !editor.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
    }
    // Insert text into the focused editor; this does not submit the message.
    if (!document.execCommand("insertText", false, text)) {
        throw new Error("Discord rejected draft insertion. Copy the generated draft from the dashboard instead.");
    }
}

const css = `
.vcd-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:3vh 3vw;color:#eee;font-family:inherit}
.vcd-window{width:min(1050px,96vw);height:min(760px,92vh);background:#101010;border:1px solid #353535;border-radius:16px;box-shadow:0 24px 90px #000b;display:flex;overflow:hidden}
.vcd-side{width:205px;background:#151515;border-right:1px solid #303030;padding:20px 12px;display:flex;flex-direction:column;gap:7px;flex-shrink:0}
.vcd-brand{font-size:17px;font-weight:800;letter-spacing:.08em;padding:5px 10px 20px;color:#fff}
.vcd-nav,.vcd-btn{border:1px solid transparent;background:transparent;color:#aaa;padding:10px 12px;border-radius:8px;text-align:left;cursor:pointer;font:inherit}
.vcd-nav:hover,.vcd-btn:hover{background:#252525;color:#fff}.vcd-nav.active{background:#292929;color:#fff;border-color:#414141}
.vcd-main{flex:1;min-width:0;display:flex;flex-direction:column}.vcd-top{height:66px;border-bottom:1px solid #303030;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.vcd-content{padding:24px;overflow:auto;flex:1}.vcd-title{font-size:24px;font-weight:750;color:#fff;margin-bottom:5px}.vcd-muted{color:#888;font-size:13px}.vcd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:20px}
.vcd-card{background:#181818;border:1px solid #303030;border-radius:12px;padding:16px}.vcd-card h3{margin:0 0 8px;color:#fff;font-size:15px}.vcd-input,.vcd-textarea,.vcd-select{width:100%;box-sizing:border-box;background:#0d0d0d;border:1px solid #3a3a3a;color:#eee;border-radius:8px;padding:10px;font:inherit;outline:none}.vcd-input:focus,.vcd-textarea:focus{border-color:#888}.vcd-textarea{min-height:150px;resize:vertical}.vcd-row{display:flex;gap:9px;align-items:center}.vcd-row>*{min-width:0}.vcd-primary{background:#eee;color:#111;border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}.vcd-secondary{background:#252525;color:#eee;border:1px solid #444;border-radius:8px;padding:9px 12px;cursor:pointer}.vcd-list{display:flex;flex-direction:column;gap:9px;margin-top:15px}.vcd-item{background:#171717;border:1px solid #303030;border-radius:10px;padding:13px;display:flex;justify-content:space-between;gap:12px}.vcd-item-title{font-weight:650;color:#eee}.vcd-item-body{font-size:13px;color:#999;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px}.vcd-label{display:block;color:#aaa;font-size:12px;margin:13px 0 6px}.vcd-status{padding:10px 12px;border-radius:8px;background:#202020;color:#bbb;font-size:13px;margin-top:12px;white-space:pre-wrap}.vcd-close{font-size:20px;padding:4px 10px}.vcd-kpi{font-size:27px;font-weight:750;color:#fff}.vcd-danger{color:#f88}.vcd-small{font-size:11px;color:#777}
`;

function DashboardButton() {
    const [open, setOpen] = React.useState(false);
    return <>
        <button className="vc-dashboard-chat-button" title="Open VC Dashboard" onClick={() => setOpen(true)} style={{ background: "transparent", border: 0, color: "var(--interactive-normal)", cursor: "pointer", padding: "4px 8px", fontWeight: 700 }}>▦</button>
        {open && <Workspace onClose={() => setOpen(false)} />}
    </>;
}

function Workspace({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = React.useState("Overview");
    const [records, setRecords] = React.useState<WorkspaceRecord[]>([]);
    const [title, setTitle] = React.useState("");
    const [body, setBody] = React.useState("");
    const [kind, setKind] = React.useState<RecordKind>("note");
    const [search, setSearch] = React.useState("");
    const [ai, setAI] = React.useState<AISettings>(loadAISettings);
    const [status, setStatus] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [draft, setDraft] = React.useState("");
    const [selectedFile, setSelectedFile] = React.useState<File | null>(null);

    const refresh = React.useCallback(async () => {
        try { setRecords(await getAllRecords()); }
        catch (e) { setStatus(`Storage error: ${String(e)}`); }
    }, []);
    React.useEffect(() => { void refresh(); }, [refresh]);

    async function saveRecord() {
        if (!title.trim() && !body.trim()) return;
        const now = Date.now();
        const record: WorkspaceRecord = { id: makeId(), kind, title: title.trim() || (kind === "link" ? body : "Untitled"), body: body.trim(), createdAt: now, updatedAt: now };
        try { await putRecord(record); setTitle(""); setBody(""); setStatus("Saved locally."); await refresh(); }
        catch (e) { setStatus(`Couldn't save: ${String(e)}`); }
    }
    async function saveFile() {
        if (!selectedFile) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const now = Date.now();
            const record: WorkspaceRecord = {
                id: makeId(), kind: "file", title: selectedFile.name, body: `${selectedFile.type || "Unknown type"} · ${selectedFile.size.toLocaleString()} bytes`,
                fileName: selectedFile.name, fileData: String(reader.result), createdAt: now, updatedAt: now
            };
            try { await putRecord(record); setSelectedFile(null); setStatus("File stored locally in IndexedDB."); await refresh(); }
            catch (e) { setStatus(`File save failed: ${String(e)}`); }
        };
        reader.onerror = () => setStatus("Couldn't read that file.");
        reader.readAsDataURL(selectedFile);
    }
    function downloadFile(record: WorkspaceRecord) {
        if (!record.fileData) return;
        const a = document.createElement("a"); a.href = record.fileData; a.download = record.fileName || record.title; a.click();
    }
    async function removeRecord(id: string) { await deleteRecord(id); await refresh(); }
    async function copyText(value: string) {
        try { await navigator.clipboard.writeText(value); setStatus("Copied to clipboard."); }
        catch { setStatus("Clipboard permission was denied by the client."); }
    }
    async function generateReply() {
        setBusy(true); setStatus("Reading recent messages and asking the selected AI provider…"); setDraft("");
        try {
            const { messages } = getRecentConversation(Math.max(3, Math.min(30, ai.contextCount)));
            if (!messages.length) throw new Error("No recent text messages were found in this channel.");
            const result = await requestDraft(ai, messages);
            if (!result.should_reply || !result.reply) {
                setStatus(`No reply suggested. ${result.reason || "The conversation doesn't appear to need a response."}`);
                return;
            }
            setDraft(result.reply);
            setStatus(`Draft ready. ${result.reason || "Review it before sending."}`);
        } catch (e) { setStatus(String(e)); }
        finally { setBusy(false); }
    }
    function exportBackup() {
        const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "vc-dashboard-backup.json"; a.click(); URL.revokeObjectURL(url);
    }
    async function importBackup(file?: File) {
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            if (!Array.isArray(parsed.records)) throw new Error("Invalid backup format.");
            for (const record of parsed.records) {
                if (record?.id && ["note", "link", "clip", "file"].includes(record.kind)) await putRecord(record);
            }
            await refresh(); setStatus("Backup imported.");
        } catch (e) { setStatus(`Import failed: ${String(e)}`); }
    }
    const filtered = records.filter(r => (tab === "Overview" || tab === "Settings" || tab === "AI" || r.kind === ({ Notes: "note", Links: "link", Clipboard: "clip", Storage: "file" } as any)[tab]) && `${r.title} ${r.body}`.toLowerCase().includes(search.toLowerCase()));

    return <div className="vcd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <style>{css}</style>
        <div className="vcd-window">
            <aside className="vcd-side">
                <div className="vcd-brand">VC / WORKSPACE</div>
                {["Overview", "Notes", "Storage", "Clipboard", "Links", "AI", "Settings"].map(item => <button key={item} className={`vcd-nav ${tab === item ? "active" : ""}`} onClick={() => { setTab(item); setSearch(""); setStatus(""); }}>{item === "Overview" ? "◫" : item === "Notes" ? "▤" : item === "Storage" ? "▣" : item === "Clipboard" ? "▢" : item === "Links" ? "↗" : item === "AI" ? "✧" : "⚙"}　{item}</button>)}
                <div style={{ flex: 1 }} />
                <div className="vcd-small">LOCAL WORKSPACE · V1</div>
            </aside>
            <main className="vcd-main">
                <header className="vcd-top"><div><strong>{tab}</strong><div className="vcd-small">Your personal Discord workspace</div></div><button className="vcd-btn vcd-close" onClick={onClose} aria-label="Close">×</button></header>
                <section className="vcd-content">
                    {tab === "Overview" && <>
                        <div className="vcd-title">Your workspace.</div><div className="vcd-muted">A private space for things you want close at hand.</div>
                        <div className="vcd-grid">
                            {[{ label: "Notes", kind: "note" }, { label: "Saved files", kind: "file" }, { label: "Clipboard", kind: "clip" }, { label: "Links", kind: "link" }].map(x => <div className="vcd-card" key={x.kind}><div className="vcd-kpi">{records.filter(r => r.kind === x.kind).length}</div><div className="vcd-muted">{x.label}</div></div>)}
                        </div>
                        <div className="vcd-card" style={{ marginTop: 14 }}><h3>Quick capture</h3><div className="vcd-row"><select className="vcd-select" value={kind} onChange={e => setKind(e.target.value as RecordKind)}><option value="note">Note</option><option value="link">Link</option><option value="clip">Clipboard</option><option value="file">Storage reference</option></select><input className="vcd-input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} /></div><textarea className="vcd-textarea" style={{ minHeight: 80, marginTop: 9 }} placeholder="Write something or paste a URL…" value={body} onChange={e => setBody(e.target.value)} /><button className="vcd-primary" style={{ marginTop: 9 }} onClick={() => void saveRecord()}>Save locally</button></div>
                        <div className="vcd-card" style={{ marginTop: 14 }}><h3>AI assistant</h3><div className="vcd-muted">Read the recent conversation, decide whether a reply is needed, and prepare a draft.</div><button className="vcd-secondary" style={{ marginTop: 12 }} onClick={() => setTab("AI")}>Open AI assistant →</button></div>
                    </>}
                    {!["Overview", "AI", "Settings"].includes(tab) && <>
                        <div className="vcd-title">{tab}</div><div className="vcd-muted">Saved on this device in IndexedDB.</div>
                        <div className="vcd-row" style={{ marginTop: 18 }}><input className="vcd-input" placeholder="Search saved items…" value={search} onChange={e => setSearch(e.target.value)} /><button className="vcd-secondary" onClick={() => setKind(({ Notes: "note", Storage: "file", Clipboard: "clip", Links: "link" } as any)[tab])}>New item</button></div>
                        <div className="vcd-card" style={{ marginTop: 12 }}>
                            {tab === "Storage" ? <><h3>Store a file locally</h3><input className="vcd-input" type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)} /><button className="vcd-primary" style={{ marginTop: 9 }} disabled={!selectedFile} onClick={() => void saveFile()}>Save file</button><div className="vcd-small" style={{ marginTop: 8 }}>Files are kept in this Discord client's IndexedDB. Large files use local browser storage quota.</div></> : <><input className="vcd-input" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} /><textarea className="vcd-textarea" style={{ minHeight: 85, marginTop: 8 }} placeholder={tab === "Links" ? "Paste URL…" : "Content…"} value={body} onChange={e => setBody(e.target.value)} /><button className="vcd-primary" style={{ marginTop: 8 }} onClick={() => void saveRecord()}>Save {tab.slice(0, -1).toLowerCase()}</button></>}
                        </div>
                        <div className="vcd-list">{filtered.map(r => <div className="vcd-item" key={r.id}><div style={{ minWidth: 0, flex: 1 }}><div className="vcd-item-title">{r.title}</div><div className="vcd-item-body">{r.body}</div></div><div className="vcd-row" style={{ alignSelf: "center" }}>{r.kind === "file" && r.fileData ? <button className="vcd-secondary" onClick={() => downloadFile(r)}>Download</button> : <button className="vcd-secondary" onClick={() => void copyText(r.body || r.title)}>Copy</button>}<button className="vcd-secondary vcd-danger" onClick={() => void removeRecord(r.id)}>Delete</button></div></div>)}{!filtered.length && <div className="vcd-muted" style={{ padding: 20, textAlign: "center" }}>Nothing saved here yet.</div>}</div>
                    </>}
                    {tab === "AI" && <>
                        <div className="vcd-title">AI reply assistant</div><div className="vcd-muted">Context-aware drafting. Nothing is sent automatically.</div>
                        <div className="vcd-card" style={{ marginTop: 18 }}><h3>Generate a reply</h3><div className="vcd-muted">Reads the most recent messages in the currently open channel and decides whether a reply is appropriate.</div><button className="vcd-primary" style={{ marginTop: 13 }} disabled={busy} onClick={() => void generateReply()}>{busy ? "Thinking…" : "✧ Generate reply"}</button>
                        {draft && <><label className="vcd-label">DRAFT — EDIT BEFORE SENDING</label><textarea className="vcd-textarea" value={draft} onChange={e => setDraft(e.target.value)} /><div className="vcd-row" style={{ marginTop: 9 }}><button className="vcd-primary" onClick={() => { try { insertIntoComposer(draft); setStatus("Draft inserted into Discord's composer. It has not been sent."); } catch (e) { setStatus(String(e)); } }}>Insert into message box</button><button className="vcd-secondary" onClick={() => void copyText(draft)}>Copy draft</button><button className="vcd-secondary" onClick={() => setDraft("")}>Discard</button></div></>}
                        </div>
                        <div className="vcd-card" style={{ marginTop: 12 }}><h3>Current configuration</h3><div className="vcd-muted">{ai.provider === "nvidia" ? "NVIDIA-compatible API" : "Local OpenAI-compatible endpoint"} · {ai.model}</div><button className="vcd-secondary" style={{ marginTop: 10 }} onClick={() => setTab("Settings")}>Configure provider</button></div>
                    </>}
                    {tab === "Settings" && <>
                        <div className="vcd-title">Settings</div><div className="vcd-muted">Configure your AI connection and workspace backups.</div>
                        <div className="vcd-card" style={{ marginTop: 16 }}><h3>AI provider</h3><label className="vcd-label">Provider</label><select className="vcd-select" value={ai.provider} onChange={e => setAI({ ...ai, provider: e.target.value as AISettings["provider"], endpoint: e.target.value === "nvidia" ? DEFAULT_AI.endpoint : "http://localhost:1234/v1/chat/completions" })}><option value="nvidia">NVIDIA API</option><option value="local">Local OpenAI-compatible server</option></select>
                            <label className="vcd-label">Chat completions endpoint</label><input className="vcd-input" value={ai.endpoint} onChange={e => setAI({ ...ai, endpoint: e.target.value })} />
                            <label className="vcd-label">Model ID</label><input className="vcd-input" value={ai.model} onChange={e => setAI({ ...ai, model: e.target.value })} />
                            <label className="vcd-label">API key {ai.provider === "local" ? "(optional)" : ""}</label><input className="vcd-input" type="password" autoComplete="off" value={ai.apiKey} onChange={e => setAI({ ...ai, apiKey: e.target.value })} placeholder="Paste provider API key" />
                            <label className="vcd-label">Messages to read: {ai.contextCount}</label><input className="vcd-input" type="range" min="3" max="30" value={ai.contextCount} onChange={e => setAI({ ...ai, contextCount: Number(e.target.value) })} />
                            <label className="vcd-label">Reply style</label><textarea className="vcd-textarea" style={{ minHeight: 75 }} value={ai.style} onChange={e => setAI({ ...ai, style: e.target.value })} />
                            <button className="vcd-primary" style={{ marginTop: 12 }} onClick={() => { saveAISettings(ai); setStatus("AI settings saved on this device."); }}>Save AI settings</button>
                            <div className="vcd-small" style={{ marginTop: 10 }}>API keys are stored in this Discord client's local storage. Use a trusted device and never share your workspace backup.</div>
                        </div>
                        <div className="vcd-card" style={{ marginTop: 12 }}><h3>Workspace backup</h3><div className="vcd-row"><button className="vcd-secondary" onClick={exportBackup}>Export JSON</button><label className="vcd-secondary" style={{ display: "inline-block" }}>Import JSON<input type="file" accept="application/json" hidden onChange={e => void importBackup(e.target.files?.[0])} /></label></div></div>
                    </>}
                    {status && <div className="vcd-status">{status}</div>}
                </section>
            </main>
        </div>
    </div>;
}

function DashboardIcon() { return <span style={{ fontSize: 18, fontWeight: 800 }}>▦</span>; }

export default definePlugin({
    name: "VCDashboard",
    description: "A local-first Discord workspace with notes, clipboard, links, storage and AI-assisted reply drafts.",
    authors: [{ name: "Sushi", id: 0n }],
    chatBarButton: {
        icon: DashboardIcon,
        render: DashboardButton
    }
});
