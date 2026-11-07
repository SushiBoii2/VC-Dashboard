import { useEffect, useMemo, useState } from "react";
import { AIConfig, DEFAULT_AI_CONFIG, readAIConfig, writeAIConfig } from "../services/ai";
import { EMPTY_WORKSPACE, loadWorkspace, saveWorkspace, WorkspaceData } from "../modules/storage";

type Tab = "home" | "notes" | "links" | "tasks" | "ai";

const uid = () => crypto.randomUUID();

export function WorkspaceDashboard({ onClose }: { onClose(): void; }) {
    const [tab, setTab] = useState<Tab>("home");
    const [data, setData] = useState<WorkspaceData>(EMPTY_WORKSPACE);
    const [loaded, setLoaded] = useState(false);
    const [noteTitle, setNoteTitle] = useState("");
    const [noteBody, setNoteBody] = useState("");
    const [linkUrl, setLinkUrl] = useState("");
    const [linkLabel, setLinkLabel] = useState("");
    const [taskText, setTaskText] = useState("");
    const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
    const [apiKey, setApiKey] = useState("");
    const [savedMessage, setSavedMessage] = useState("");

    useEffect(() => {
        let active = true;
        loadWorkspace().then(value => {
            if (active) { setData(value); setLoaded(true); }
        }).catch(error => {
            console.error("[DiscordWorkspace] Failed to load workspace", error);
            if (active) setLoaded(true);
        });
        setAiConfig(readAIConfig());
        setApiKey(sessionStorage.getItem("discord-workspace-ai-key") || "");
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (loaded) saveWorkspace(data).catch(error => console.error("[DiscordWorkspace] Save failed", error));
    }, [data, loaded]);

    const completed = useMemo(() => data.tasks.filter(task => task.done).length, [data.tasks]);

    const addNote = () => {
        if (!noteTitle.trim() && !noteBody.trim()) return;
        setData(current => ({ ...current, notes: [{ id: uid(), title: noteTitle.trim() || "Untitled", body: noteBody, updatedAt: Date.now() }, ...current.notes] }));
        setNoteTitle(""); setNoteBody("");
    };

    const addLink = () => {
        if (!/^https?:\/\//i.test(linkUrl.trim())) { setSavedMessage("Enter a valid http(s) URL."); return; }
        setData(current => ({ ...current, links: [{ id: uid(), url: linkUrl.trim(), label: linkLabel.trim() || linkUrl.trim(), addedAt: Date.now() }, ...current.links] }));
        setLinkUrl(""); setLinkLabel(""); setSavedMessage("Link saved locally.");
    };

    const addTask = () => {
        if (!taskText.trim()) return;
        setData(current => ({ ...current, tasks: [{ id: uid(), text: taskText.trim(), done: false, addedAt: Date.now() }, ...current.tasks] }));
        setTaskText("");
    };

    const saveAI = () => {
        writeAIConfig(aiConfig);
        if (apiKey.trim()) sessionStorage.setItem("discord-workspace-ai-key", apiKey.trim());
        else sessionStorage.removeItem("discord-workspace-ai-key");
        setSavedMessage("AI settings saved. API key is kept for this Vesktop session only.");
    };

    return <div className="dw-shell" role="dialog" aria-label="Discord Workspace">
        <aside className="dw-sidebar">
            <div className="dw-brand"><span className="dw-brand-mark">W</span><span>WORKSPACE</span></div>
            <div className="dw-nav-label">PERSONAL</div>
            {([ ["home", "Overview"], ["notes", "Notes"], ["links", "Links"], ["tasks", "Tasks"], ["ai", "AI assistant"] ] as [Tab, string][]).map(([id, label]) =>
                <button key={id} className={`dw-nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
            )}
            <div className="dw-sidebar-bottom"><span className="dw-status-dot" /> LOCAL STORAGE</div>
        </aside>

        <main className="dw-main">
            <header className="dw-topbar">
                <div><div className="dw-eyebrow">YOUR PERSONAL SPACE</div><h1>{({ home: "Overview", notes: "Notes", links: "Saved links", tasks: "Tasks", ai: "AI assistant" } as Record<Tab, string>)[tab]}</h1></div>
                <button className="dw-close" onClick={onClose} aria-label="Close workspace">×</button>
            </header>
            {savedMessage && <div className="dw-notice">{savedMessage}<button onClick={() => setSavedMessage("")}>×</button></div>}

            {tab === "home" && <section className="dw-page">
                <div className="dw-welcome"><div className="dw-eyebrow">WORKSPACE / HOME</div><h2>Everything in one place.</h2><p>Your notes, links and tasks stay on this device.</p></div>
                <div className="dw-stat-grid">
                    <div className="dw-stat"><span>NOTES</span><strong>{data.notes.length}</strong></div>
                    <div className="dw-stat"><span>LINKS</span><strong>{data.links.length}</strong></div>
                    <div className="dw-stat"><span>OPEN TASKS</span><strong>{data.tasks.length - completed}</strong></div>
                </div>
                <div className="dw-two-col">
                    <div className="dw-panel"><div className="dw-panel-title">RECENT NOTES</div>{data.notes.slice(0, 4).map(note => <div className="dw-list-row" key={note.id}><strong>{note.title}</strong><span>{note.body.slice(0, 72) || "Empty note"}</span></div>)}{!data.notes.length && <p className="dw-empty">No notes yet.</p>}</div>
                    <div className="dw-panel"><div className="dw-panel-title">YOUR TASKS</div>{data.tasks.slice(0, 5).map(task => <div className="dw-list-row" key={task.id}><strong>{task.done ? "✓ " : "○ "}{task.text}</strong></div>)}{!data.tasks.length && <p className="dw-empty">Nothing on your list.</p>}</div>
                </div>
            </section>}

            {tab === "notes" && <section className="dw-page">
                <div className="dw-panel dw-editor"><div className="dw-panel-title">NEW NOTE</div><input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Note title" /><textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder="Write something…" rows={5} /><button className="dw-primary" onClick={addNote}>Save note</button></div>
                <div className="dw-card-grid">{data.notes.map(note => <article className="dw-panel dw-note" key={note.id}><div className="dw-note-head"><strong>{note.title}</strong><button onClick={() => setData(current => ({ ...current, notes: current.notes.filter(item => item.id !== note.id) }))}>Delete</button></div><p>{note.body || "(empty)"}</p><small>{new Date(note.updatedAt).toLocaleString()}</small></article>)}</div>
            </section>}

            {tab === "links" && <section className="dw-page">
                <div className="dw-panel dw-form-row"><input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Name (optional)" /><input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://example.com" /><button className="dw-primary" onClick={addLink}>Save link</button></div>
                <div className="dw-panel">{data.links.map(link => <div className="dw-link-row" key={link.id}><div><strong>{link.label}</strong><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></div><button onClick={() => setData(current => ({ ...current, links: current.links.filter(item => item.id !== link.id) }))}>Remove</button></div>)}{!data.links.length && <p className="dw-empty">Your saved links will appear here.</p>}</div>
            </section>}

            {tab === "tasks" && <section className="dw-page">
                <div className="dw-panel dw-form-row"><input value={taskText} onChange={e => setTaskText(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Add a task…" /><button className="dw-primary" onClick={addTask}>Add task</button></div>
                <div className="dw-panel">{data.tasks.map(task => <div className="dw-task-row" key={task.id}><label><input type="checkbox" checked={task.done} onChange={e => setData(current => ({ ...current, tasks: current.tasks.map(item => item.id === task.id ? { ...item, done: e.target.checked } : item) }))} /><span className={task.done ? "done" : ""}>{task.text}</span></label><button onClick={() => setData(current => ({ ...current, tasks: current.tasks.filter(item => item.id !== task.id) }))}>×</button></div>)}{!data.tasks.length && <p className="dw-empty">No tasks yet.</p>}</div>
            </section>}

            {tab === "ai" && <section className="dw-page">
                <div className="dw-panel dw-ai-settings"><div className="dw-panel-title">AI PROVIDER</div><p className="dw-muted">NVIDIA NIM and other OpenAI-compatible chat-completions endpoints are supported.</p>
                    <label>API endpoint<input value={aiConfig.endpoint} onChange={e => setAiConfig(current => ({ ...current, endpoint: e.target.value }))} /></label>
                    <label>Model identifier<input value={aiConfig.model} onChange={e => setAiConfig(current => ({ ...current, model: e.target.value }))} /></label>
                    <label>API key (session only)<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Paste provider API key" autoComplete="off" /></label>
                    <label>Messages to read: {aiConfig.messageCount}<input type="range" min="3" max="20" value={aiConfig.messageCount} onChange={e => setAiConfig(current => ({ ...current, messageCount: Number(e.target.value) }))} /></label>
                    <button className="dw-primary" onClick={saveAI}>Save AI settings</button>
                    <p className="dw-footnote">The API key is held in session storage and cleared when the Vesktop session ends. Conversation messages are sent to the provider only when you press the AI reply button or make an AI request.</p>
                </div>
            </section>}
        </main>
    </div>;
}
