/*
 * VC Dashboard — local-first Vencord userplugin
 * Place this folder at src/userplugins/vcDashboard in a Vencord source checkout.
 */

import { React } from "@webpack/common";
import definePlugin from "@utils/types";

const DB_NAME = "vc-dashboard-workspace";
const DB_VERSION = 1;
const STORE = "records";
const SETTINGS_KEY = "vc-dashboard-settings-v2";

type RecordKind = "note" | "link" | "clip" | "file" | "task";
type WorkspaceRecord = {
    id: string;
    kind: RecordKind;
    title: string;
    body: string;
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    pinned?: boolean;
    completed?: boolean;
    dueAt?: number;
    priority?: "low" | "normal" | "high" | "urgent";
    fileData?: string;
    fileName?: string;
    folder?: string;
    deletedAt?: number;
};

type WorkspaceSettings = {
    compactMode: boolean;
    confirmDelete: boolean;
    sortBy: "updated" | "created" | "title";
};

const DEFAULT_SETTINGS: WorkspaceSettings = {
    compactMode: false,
    confirmDelete: true,
    sortBy: "updated"
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
        req.onsuccess = () => resolve(req.result as WorkspaceRecord[]);
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
        tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted."));
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

function loadSettings(): WorkspaceSettings {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings: WorkspaceSettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseTags(value: string) {
    return [...new Set(value.split(",").map(x => x.trim().replace(/^#/, "")).filter(Boolean))].slice(0, 20);
}

function formatDate(value?: number) {
    if (!value) return "No due date";
    return new Date(value).toLocaleString();
}

function safeUrl(value: string) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

const css = `
.vcd-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:3vh 3vw;color:#eee;font-family:inherit}
.vcd-window{width:min(1160px,97vw);height:min(800px,94vh);background:#101010;border:1px solid #353535;border-radius:16px;box-shadow:0 24px 90px #000b;display:flex;overflow:hidden}
.vcd-side{width:205px;background:#151515;border-right:1px solid #303030;padding:20px 12px;display:flex;flex-direction:column;gap:6px;flex-shrink:0}
.vcd-brand{font-size:16px;font-weight:850;letter-spacing:.09em;padding:5px 10px 20px;color:#fff}
.vcd-nav,.vcd-btn{border:1px solid transparent;background:transparent;color:#aaa;padding:10px 12px;border-radius:8px;text-align:left;cursor:pointer;font:inherit}
.vcd-nav:hover,.vcd-btn:hover{background:#252525;color:#fff}.vcd-nav.active{background:#292929;color:#fff;border-color:#414141}
.vcd-main{flex:1;min-width:0;display:flex;flex-direction:column}.vcd-top{min-height:66px;border-bottom:1px solid #303030;display:flex;align-items:center;justify-content:space-between;padding:0 22px}
.vcd-content{padding:23px;overflow:auto;flex:1}.vcd-title{font-size:24px;font-weight:750;color:#fff;margin-bottom:5px}.vcd-muted{color:#888;font-size:13px}.vcd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:11px;margin-top:18px}
.vcd-card{background:#181818;border:1px solid #303030;border-radius:12px;padding:15px}.vcd-card h3{margin:0 0 8px;color:#fff;font-size:15px}
.vcd-input,.vcd-textarea,.vcd-select{width:100%;box-sizing:border-box;background:#0d0d0d;border:1px solid #3a3a3a;color:#eee;border-radius:8px;padding:10px;font:inherit;outline:none}
.vcd-input:focus,.vcd-textarea:focus,.vcd-select:focus{border-color:#888}.vcd-textarea{min-height:130px;resize:vertical}
.vcd-row{display:flex;gap:8px;align-items:center}.vcd-row>*{min-width:0}.vcd-primary{background:#eee;color:#111;border:0;border-radius:8px;padding:10px 14px;font-weight:750;cursor:pointer}
.vcd-secondary{background:#252525;color:#eee;border:1px solid #444;border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit;font-size:12px}
.vcd-secondary:disabled,.vcd-primary:disabled{opacity:.45;cursor:not-allowed}.vcd-list{display:flex;flex-direction:column;gap:9px;margin-top:14px}
.vcd-item{background:#171717;border:1px solid #303030;border-radius:10px;padding:13px;display:flex;justify-content:space-between;gap:12px}
.vcd-item.pinned{border-color:#777}.vcd-item-title{font-weight:650;color:#eee;overflow-wrap:anywhere}.vcd-item-body{font-size:13px;color:#999;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:5px;max-height:120px;overflow:auto}
.vcd-label{display:block;color:#aaa;font-size:12px;margin:12px 0 6px}.vcd-status{padding:10px 12px;border-radius:8px;background:#202020;color:#bbb;font-size:13px;margin-top:12px;white-space:pre-wrap}
.vcd-close{font-size:20px;padding:4px 10px}.vcd-kpi{font-size:27px;font-weight:750;color:#fff}.vcd-danger{color:#f88}.vcd-small{font-size:11px;color:#777}
.vcd-tag{display:inline-block;border:1px solid #444;border-radius:20px;padding:3px 8px;color:#aaa;font-size:11px;margin:7px 5px 0 0}
.vcd-check{accent-color:#eee}.vcd-empty{padding:26px;text-align:center;color:#777;border:1px dashed #383838;border-radius:10px;margin-top:14px}
.vcd-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px}.vcd-toolbar .vcd-input{flex:1;min-width:160px}
@media(max-width:700px){.vcd-overlay{padding:0}.vcd-window{width:100vw;height:100vh;border-radius:0}.vcd-side{width:145px;padding:12px 7px}.vcd-content{padding:14px}.vcd-item{flex-direction:column}.vcd-top{padding:0 14px}}
`;

function DashboardIcon() {
    return <span style={{ fontSize: 18, fontWeight: 850 }}>▦</span>;
}

function DashboardButton() {
    const [open, setOpen] = React.useState(false);
    return <>
        <button className="vc-dashboard-chat-button" title="Open VC Dashboard" aria-label="Open VC Dashboard"
            onClick={() => setOpen(true)}
            style={{ background: "transparent", border: 0, color: "var(--interactive-normal)", cursor: "pointer", padding: "4px 8px", fontWeight: 700 }}>
            ▦
        </button>
        {open && <Workspace onClose={() => setOpen(false)} />}
    </>;
}

function Workspace({ onClose }: { onClose: () => void }) {
    const tabs = ["Overview", "Search", "Notes", "Tasks", "Calendar", "Links", "Clipboard", "Files", "Trash", "Settings"];
    const kindByTab: Record<string, RecordKind> = { Notes: "note", Tasks: "task", Links: "link", Clipboard: "clip", Files: "file" };
    const [tab, setTab] = React.useState("Overview");
    const [records, setRecords] = React.useState<WorkspaceRecord[]>([]);
    const [title, setTitle] = React.useState("");
    const [body, setBody] = React.useState("");
    const [tags, setTags] = React.useState("");
    const [folder, setFolder] = React.useState("");
    const [dueAt, setDueAt] = React.useState("");
    const [priority, setPriority] = React.useState<"low" | "normal" | "high" | "urgent">("normal");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [search, setSearch] = React.useState("");
    const [status, setStatus] = React.useState("");
    const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
    const [settings, setSettings] = React.useState<WorkspaceSettings>(loadSettings);
    const [showCompleted, setShowCompleted] = React.useState(true);
    const [filterTag, setFilterTag] = React.useState("");

    const refresh = React.useCallback(async () => {
        try { setRecords(await getAllRecords()); }
        catch (e) { setStatus(`Storage error: ${String(e)}`); }
    }, []);

    React.useEffect(() => { void refresh(); }, [refresh]);

    function resetEditor() {
        setTitle("");
        setBody("");
        setTags("");
        setFolder("");
        setDueAt("");
        setPriority("normal");
        setEditingId(null);
        setSelectedFile(null);
    }

    function startEdit(record: WorkspaceRecord) {
        setEditingId(record.id);
        setTitle(record.title);
        setBody(record.body);
        setTags((record.tags || []).join(", "));
        setFolder(record.folder || "");
        setDueAt(record.dueAt ? new Date(record.dueAt).toISOString().slice(0, 16) : "");
        setPriority(record.priority || "normal");
        setTab(record.kind === "file" ? "Files" : record.kind === "clip" ? "Clipboard" : record.kind === "task" ? "Tasks" : record.kind === "link" ? "Links" : "Notes");
        setStatus("Editing saved item.");
        window.setTimeout(() => document.querySelector(".vcd-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }

    async function saveRecord(kind: RecordKind) {
        if (!title.trim() && !body.trim()) return;
        const now = Date.now();
        const previous = editingId ? records.find(r => r.id === editingId) : undefined;
        const record: WorkspaceRecord = {
            id: editingId || makeId(),
            kind,
            title: title.trim() || (kind === "link" ? body.trim() : kind === "task" ? "Untitled task" : "Untitled"),
            body: body.trim(),
            createdAt: previous?.createdAt || now,
            updatedAt: now,
            tags: parseTags(tags),
            folder: folder.trim() || undefined,
            pinned: previous?.pinned || false,
            completed: kind === "task" ? (previous?.completed || false) : undefined,
            dueAt: kind === "task" && dueAt ? new Date(dueAt).getTime() : undefined,
            priority: kind === "task" ? priority : undefined
        };
        try {
            await putRecord(record);
            resetEditor();
            setStatus(editingId ? "Changes saved." : "Saved locally.");
            await refresh();
        } catch (e) {
            setStatus(`Couldn't save: ${String(e)}`);
        }
    }

    async function saveFile() {
        if (!selectedFile) return;
        const file = selectedFile;
        const reader = new FileReader();
        reader.onload = async () => {
            const now = Date.now();
            const previous = editingId ? records.find(r => r.id === editingId) : undefined;
            const record: WorkspaceRecord = {
                id: editingId || makeId(), kind: "file", title: title.trim() || file.name,
                body: `${file.type || "Unknown type"} · ${file.size.toLocaleString()} bytes`,
                tags: parseTags(tags), folder: folder.trim() || undefined, pinned: previous?.pinned || false,
                fileName: file.name, fileData: String(reader.result),
                createdAt: previous?.createdAt || now, updatedAt: now
            };
            try {
                await putRecord(record);
                resetEditor();
                setStatus("File stored locally in this Discord client.");
                await refresh();
            } catch (e) { setStatus(`File save failed: ${String(e)}`); }
        };
        reader.onerror = () => setStatus("Couldn't read that file.");
        reader.readAsDataURL(file);
    }

    function downloadFile(record: WorkspaceRecord) {
        if (!record.fileData) return;
        const a = document.createElement("a");
        a.href = record.fileData;
        a.download = record.fileName || record.title;
        a.click();
    }

    async function removeRecord(record: WorkspaceRecord) {
        if (settings.confirmDelete && !window.confirm(`Move "${record.title}" to the recycle bin?`)) return;
        await putRecord({ ...record, deletedAt: Date.now(), updatedAt: Date.now() });
        if (editingId === record.id) resetEditor();
        await refresh();
        setStatus("Moved to recycle bin. You can restore it from Trash.");
    }

    async function restoreRecord(record: WorkspaceRecord) {
        const { deletedAt: _deletedAt, ...restored } = record;
        await putRecord({ ...restored, updatedAt: Date.now() });
        await refresh();
        setStatus("Item restored.");
    }

    async function permanentlyDeleteRecord(record: WorkspaceRecord) {
        if (!window.confirm(`Permanently delete "${record.title}"? This cannot be undone.`)) return;
        await deleteRecord(record.id);
        await refresh();
        setStatus("Item permanently deleted.");
    }

    async function copyText(value: string) {
        try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied to system clipboard.");
        } catch {
            setStatus("Clipboard permission was denied by the client.");
        }
    }

    async function togglePinned(record: WorkspaceRecord) {
        await putRecord({ ...record, pinned: !record.pinned, updatedAt: Date.now() });
        await refresh();
    }

    async function toggleTask(record: WorkspaceRecord) {
        await putRecord({ ...record, completed: !record.completed, updatedAt: Date.now() });
        await refresh();
    }

    async function duplicateRecord(record: WorkspaceRecord) {
        await putRecord({ ...record, id: makeId(), title: `${record.title} (copy)`, createdAt: Date.now(), updatedAt: Date.now(), pinned: false });
        await refresh();
        setStatus("Item duplicated.");
    }

    function exportBackup() {
        const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), records }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "vc-dashboard-backup.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    async function importBackup(file?: File) {
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            if (!Array.isArray(parsed.records)) throw new Error("Invalid backup format.");
            for (const item of parsed.records) {
                if (!item?.id || !["note", "link", "clip", "file", "task"].includes(item.kind)) continue;
                const now = Date.now();
                await putRecord({
                    id: String(item.id), kind: item.kind, title: String(item.title || "Imported item"),
                    body: String(item.body || ""), createdAt: Number(item.createdAt) || now,
                    updatedAt: now, tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
                    pinned: Boolean(item.pinned), completed: Boolean(item.completed),
                    dueAt: Number(item.dueAt) || undefined,
                    priority: ["low", "normal", "high", "urgent"].includes(item.priority) ? item.priority : "normal",
                    fileName: item.fileName ? String(item.fileName) : undefined,
                    fileData: item.fileData ? String(item.fileData) : undefined,
                    folder: item.folder ? String(item.folder) : undefined,
                    deletedAt: Number(item.deletedAt) || undefined
                });
            }
            await refresh();
            setStatus("Backup imported successfully.");
        } catch (e) {
            setStatus(`Import failed: ${String(e)}`);
        }
    }

    const activeKind = kindByTab[tab];
    const activeRecords = records.filter(r => !r.deletedAt);
    const trashedRecords = records.filter(r => Boolean(r.deletedAt));
    const folders = [...new Set(activeRecords.map(r => r.folder).filter(Boolean) as string[])].sort();
    const filtered = activeRecords
        .filter(r => !activeKind || r.kind === activeKind)
        .filter(r => showCompleted || r.kind !== "task" || !r.completed)
        .filter(r => !filterTag || (r.tags || []).some(t => t.toLowerCase() === filterTag.toLowerCase()))
        .filter(r => !folder || (r.folder || "") === folder)
        .filter(r => `${r.title} ${r.body} ${(r.tags || []).join(" ")}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => {
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
            if (settings.sortBy === "title") return a.title.localeCompare(b.title);
            return settings.sortBy === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt;
        });

    const allTags = [...new Set(activeRecords.flatMap(r => r.tags || []))].sort();
    const counts = {
        note: activeRecords.filter(r => r.kind === "note").length,
        taskOpen: activeRecords.filter(r => r.kind === "task" && !r.completed).length,
        link: activeRecords.filter(r => r.kind === "link").length,
        clip: activeRecords.filter(r => r.kind === "clip").length,
        file: activeRecords.filter(r => r.kind === "file").length,
        pinned: activeRecords.filter(r => r.pinned).length
    };

    function renderEditor(kind: RecordKind) {
        return <div className="vcd-card vcd-editor" style={{ marginTop: 14 }}>
            <div className="vcd-row" style={{ justifyContent: "space-between" }}>
                <h3>{editingId ? "Edit item" : `New ${kind === "clip" ? "clipboard snippet" : kind}`}</h3>
                {editingId && <button className="vcd-secondary" onClick={resetEditor}>Cancel edit</button>}
            </div>
            {kind !== "file" && <>
                <label className="vcd-label">Title</label>
                <input className="vcd-input" placeholder={kind === "task" ? "What needs doing?" : "Give it a title…"} value={title} onChange={e => setTitle(e.target.value)} />
                <label className="vcd-label">{kind === "link" ? "URL or description" : kind === "clip" ? "Snippet text" : "Content"}</label>
                <textarea className="vcd-textarea" style={{ minHeight: 90 }} placeholder={kind === "link" ? "https://example.com" : "Write or paste something…"} value={body} onChange={e => setBody(e.target.value)} />
            </>}
            {kind === "file" && <>
                <label className="vcd-label">Choose a file</label>
                <input className="vcd-input" type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
                {selectedFile && <div className="vcd-small" style={{ marginTop: 7 }}>{selectedFile.name} · {selectedFile.size.toLocaleString()} bytes</div>}
                {editingId && <div className="vcd-small" style={{ marginTop: 7 }}>Choose a new file to replace the stored file.</div>}
            </>}
            {kind === "task" && <>
                <label className="vcd-label">Priority</label>
                <select className="vcd-select" value={priority} onChange={e => setPriority(e.target.value as typeof priority)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
                <label className="vcd-label">Due date (optional)</label>
                <input className="vcd-input" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
            </>}
            <label className="vcd-label">Folder (optional)</label>
            <input className="vcd-input" list="vcd-folder-options" placeholder="e.g. School, Projects, Personal" value={folder} onChange={e => setFolder(e.target.value)} />
            <datalist id="vcd-folder-options">{folders.map(name => <option key={name} value={name} />)}</datalist>
            <label className="vcd-label">Tags (comma separated)</label>
            <input className="vcd-input" placeholder="school, project, important" value={tags} onChange={e => setTags(e.target.value)} />
            <div className="vcd-row" style={{ marginTop: 10 }}>
                <button className="vcd-primary" disabled={kind === "file" ? !selectedFile : !title.trim() && !body.trim()} onClick={() => kind === "file" ? void saveFile() : void saveRecord(kind)}>{editingId ? "Save changes" : "Save locally"}</button>
                {!editingId && <button className="vcd-secondary" onClick={resetEditor}>Clear</button>}
            </div>
        </div>;
    }

    function renderItems(items: WorkspaceRecord[]) {
        if (!items.length) return <div className="vcd-empty">Nothing here yet. Add something above to get started.</div>;
        return <div className="vcd-list">{items.map(record => {
            const link = record.kind === "link" ? safeUrl(record.body || record.title) : null;
            return <div className={`vcd-item ${record.pinned ? "pinned" : ""}`} key={record.id}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="vcd-item-title">{record.kind === "task" && <input className="vcd-check" type="checkbox" checked={Boolean(record.completed)} onChange={() => void toggleTask(record)} />} {record.pinned ? "★ " : ""}{record.title}</div>
                    {record.body && <div className="vcd-item-body">{record.body}</div>}
                    {record.kind === "task" && <div className="vcd-small" style={{ marginTop: 6 }}>{record.completed ? "Completed" : `Due: ${formatDate(record.dueAt)}`} · Priority: {(record.priority || "normal").toUpperCase()}</div>}
                    {record.folder && <span className="vcd-tag">▰ {record.folder}</span>}
                    {record.tags?.map(tag => <span className="vcd-tag" key={tag}>#{tag}</span>)}
                    <div className="vcd-small" style={{ marginTop: 7 }}>Updated {new Date(record.updatedAt).toLocaleString()}</div>
                </div>
                <div className="vcd-row" style={{ alignSelf: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {record.kind === "file" && record.fileData
                        ? <button className="vcd-secondary" onClick={() => downloadFile(record)}>Download</button>
                        : record.kind === "link" && link
                            ? <button className="vcd-secondary" onClick={() => window.open(link, "_blank", "noopener,noreferrer")}>Open</button>
                            : <button className="vcd-secondary" onClick={() => void copyText(record.body || record.title)}>Copy</button>}
                    <button className="vcd-secondary" title="Pin or unpin" onClick={() => void togglePinned(record)}>{record.pinned ? "Unpin" : "Pin"}</button>
                    <button className="vcd-secondary" onClick={() => void duplicateRecord(record)}>Duplicate</button>
                    <button className="vcd-secondary" onClick={() => startEdit(record)}>Edit</button>
                    <button className="vcd-secondary vcd-danger" onClick={() => void removeRecord(record)}>Delete</button>
                </div>
            </div>;
        })}</div>;
    }

    return <div className="vcd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <style>{css}</style>
        <div className="vcd-window">
            <aside className="vcd-side">
                <div className="vcd-brand">VC / WORKSPACE</div>
                {tabs.map(item => <button key={item} className={`vcd-nav ${tab === item ? "active" : ""}`} onClick={() => { setTab(item); setSearch(""); setFilterTag(""); setStatus(""); resetEditor(); }}>
                    {({ Overview: "◫", Notes: "▤", Tasks: "☑", Calendar: "▦", Links: "↗", Clipboard: "▢", Files: "▣", Settings: "⚙" } as Record<string, string>)[item]}　{item}
                </button>)}
                <div style={{ flex:  1 }} />
                <div className="vcd-small">LOCAL WORKSPACE · V2</div>
            </aside>
            <main className="vcd-main">
                <header className="vcd-top">
                    <div><strong>{tab}</strong><div className="vcd-small">Your personal Discord workspace</div></div>
                    <button className="vcd-btn vcd-close" onClick={onClose} aria-label="Close">×</button>
                </header>
                <section className="vcd-content">
                    {tab === "Overview" && <>
                        <div className="vcd-title">Your workspace.</div>
                        <div className="vcd-muted">A tidy home for notes, tasks, links, snippets and files.</div>
                        <div className="vcd-grid">
                            {[["Notes", counts.note], ["Open tasks", counts.taskOpen], ["Links", counts.link], ["Clipboard", counts.clip], ["Files", counts.file], ["Pinned", counts.pinned]].map(([label, value]) =>
                                <div className="vcd-card" key={String(label)}><div className="vcd-kpi">{value}</div><div className="vcd-muted">{label}</div></div>
                            )}
                        </div>
                        <div className="vcd-card" style={{ marginTop: 14 }}>
                            <h3>Quick capture</h3>
                            <div className="vcd-row">
                                <select className="vcd-select" value={tab === "Overview" ? "note" : kindByTab[tab] || "note"} onChange={e => { const k = e.target.value as RecordKind; setTab(({ note: "Notes", task: "Tasks", link: "Links", clip: "Clipboard", file: "Files" } as Record<RecordKind, string>)[k]); resetEditor(); }}>
                                    <option value="note">Note</option><option value="task">Task</option><option value="link">Link</option><option value="clip">Clipboard snippet</option><option value="file">File</option>
                                </select>
                                <span className="vcd-small">Choose a section to create an item</span>
                            </div>
                        </div>
                        <div className="vcd-card" style={{ marginTop: 14 }}>
                            <div className="vcd-row" style={{ justifyContent: "space-between" }}><h3>Recently updated</h3><button className="vcd-secondary" onClick={() => setTab("Notes")}>Browse all</button></div>
                            {renderItems(activeRecords.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4))}
                        </div>
                    </>}
                    {tab === "Search" && <>
                        <div className="vcd-title">Global search</div>
                        <div className="vcd-muted">Search across every active note, task, link, snippet and file.</div>
                        <div className="vcd-toolbar">
                            <input className="vcd-input" autoFocus placeholder="Search your whole workspace…" value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        {renderItems(activeRecords.filter(r => `${r.title} ${r.body} ${(r.tags || []).join(" ")} ${r.folder || ""}`.toLowerCase().includes(search.toLowerCase())))}
                    </>}
                    {tab === "Trash" && <>
                        <div className="vcd-title">Recycle bin</div>
                        <div className="vcd-muted">Deleted items stay here until you permanently remove them.</div>
                        {trashedRecords.length > 0 && <div className="vcd-toolbar"><button className="vcd-secondary" onClick={async () => { for (const item of trashedRecords) { const { deletedAt: _deletedAt, ...restored } = item; await putRecord({ ...restored, updatedAt: Date.now() }); } await refresh(); setStatus("All items restored."); }}>Restore all</button></div>}
                        {!trashedRecords.length ? <div className="vcd-empty">Your recycle bin is empty.</div> : <div className="vcd-list">{trashedRecords.slice().sort((a,b) => (b.deletedAt || 0) - (a.deletedAt || 0)).map(record => <div className="vcd-item" key={record.id}><div style={{minWidth:0,flex:1}}><div className="vcd-item-title">{record.title}</div><div className="vcd-small">Deleted {formatDate(record.deletedAt)}</div></div><div className="vcd-row" style={{flexWrap:"wrap"}}><button className="vcd-secondary" onClick={() => void restoreRecord(record)}>Restore</button><button className="vcd-secondary vcd-danger" onClick={() => void permanentlyDeleteRecord(record)}>Delete forever</button></div></div>)}</div>}
                    </>}
                    {activeKind && <>
                        <div className="vcd-title">{tab}</div>
                        <div className="vcd-muted">Saved locally in this Discord client's IndexedDB.</div>
                        {tab === "Tasks" && <label className="vcd-row" style={{ marginTop: 12, color: "#aaa", fontSize: 12 }}><input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} /> Show completed tasks</label>}
                        {tab !== "Files" && renderEditor(activeKind)}
                        {tab === "Files" && <div className="vcd-card vcd-editor" style={{ marginTop: 14 }}>
                            <h3>Store a file locally</h3>
                            <input className="vcd-input" type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />
                            {selectedFile && <div className="vcd-small" style={{ marginTop: 7 }}>{selectedFile.name} · {selectedFile.size.toLocaleString()} bytes</div>}
                            <div className="vcd-row" style={{ marginTop: 9 }}><button className="vcd-primary" disabled={!selectedFile} onClick={() => void saveFile()}>Save file</button></div>
                            <div className="vcd-small" style={{ marginTop: 9 }}>Files count toward this client's browser storage quota. Keep backups of important files.</div>
                        </div>}
                        <div className="vcd-toolbar">
                            <input className="vcd-input" placeholder={`Search ${tab.toLowerCase()}…`} value={search} onChange={e => setSearch(e.target.value)} />
                            <select className="vcd-select" style={{ width: 155 }} value={filterTag} onChange={e => setFilterTag(e.target.value)}><option value="">All tags</option>{allTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}</select>
                            <select className="vcd-select" style={{ width: 155 }} value={folder} onChange={e => setFolder(e.target.value)}><option value="">All folders</option>{folders.map(name => <option key={name} value={name}>{name}</option>)}</select>
                        </div>
                        {renderItems(filtered)}
                    </>}
                    {tab === "Calendar" && <>
                        <div className="vcd-title">Task calendar</div>
                        <div className="vcd-muted">A date-oriented view of your tasks, ordered by deadline and priority.</div>
                        <div className="vcd-grid">
                            {[
                                ["Overdue", activeRecords.filter(r => r.kind === "task" && !r.completed && r.dueAt && r.dueAt < Date.now()).length],
                                ["Due today", activeRecords.filter(r => r.kind === "task" && !r.completed && r.dueAt && new Date(r.dueAt).toDateString() === new Date().toDateString()).length],
                                ["Upcoming", activeRecords.filter(r => r.kind === "task" && !r.completed && r.dueAt && r.dueAt >= Date.now() && new Date(r.dueAt).toDateString() !== new Date().toDateString()).length]
                            ].map(([label, value]) => <div className="vcd-card" key={String(label)}><div className="vcd-kpi">{value}</div><div className="vcd-muted">{label}</div></div>)}
                        </div>
                        <div className="vcd-card" style={{ marginTop: 14 }}>
                            <h3>Tasks without a deadline</h3>
                            {renderItems(activeRecords.filter(r => r.kind === "task" && !r.completed && !r.dueAt))}
                        </div>
                        {(() => {
                            const dated = activeRecords.filter(r => r.kind === "task" && !r.completed && r.dueAt).sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0) || ({ urgent: 0, high: 1, normal: 2, low: 3 }[a.priority || "normal"] - { urgent: 0, high: 1, normal: 2, low: 3 }[b.priority || "normal"]));
                            const groups = new Map<string, WorkspaceRecord[]>();
                            for (const task of dated) {
                                const key = new Date(task.dueAt!).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
                                groups.set(key, [...(groups.get(key) || []), task]);
                            }
                            return [...groups.entries()].map(([day, tasks]) => <div className="vcd-card" style={{ marginTop: 12 }} key={day}><h3>{day}</h3>{renderItems(tasks)}</div>);
                        })()}
                        <div className="vcd-card" style={{ marginTop: 12 }}>
                            <h3>Completed tasks</h3>
                            {renderItems(activeRecords.filter(r => r.kind === "task" && r.completed))}
                        </div>
                    </>}
                    {tab === "Settings" && <>
                        <div className="vcd-title">Settings & backups</div>
                        <div className="vcd-muted">Manage how your workspace behaves and protect your data.</div>
                        <div className="vcd-card" style={{ marginTop: 16 }}>
                            <h3>Workspace preferences</h3>
                            <label className="vcd-label">Default sorting</label>
                            <select className="vcd-select" value={settings.sortBy} onChange={e => setSettings({ ...settings, sortBy: e.target.value as WorkspaceSettings["sortBy"] })}>
                                <option value="updated">Recently updated</option><option value="created">Recently created</option><option value="title">Alphabetical</option>
                            </select>
                            <label className="vcd-row" style={{ marginTop: 12, color: "#bbb", fontSize: 13 }}><input type="checkbox" checked={settings.confirmDelete} onChange={e => setSettings({ ...settings, confirmDelete: e.target.checked })} /> Confirm before deleting items</label>
                            <button className="vcd-primary" style={{ marginTop: 12 }} onClick={() => { saveSettings(settings); setStatus("Preferences saved."); }}>Save preferences</button>
                        </div>
                        <div className="vcd-card" style={{ marginTop: 12 }}>
                            <h3>Workspace backup</h3>
                            <div className="vcd-muted">Export all notes, tasks, links, snippets and stored files into one JSON backup.</div>
                            <div className="vcd-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                                <button className="vcd-secondary" onClick={exportBackup}>Export JSON</button>
                                <label className="vcd-secondary" style={{ display: "inline-block" }}>Import JSON<input type="file" accept="application/json" hidden onChange={e => void importBackup(e.target.files?.[0])} /></label>
                            </div>
                        </div>
                        <div className="vcd-card" style={{ marginTop: 12 }}>
                            <h3>About your data</h3>
                            <div className="vcd-muted">Your workspace is stored locally in IndexedDB. It is not synced to Discord servers. Clearing Vesktop's site/client data may remove it, so export backups periodically.</div>
                        </div>
                    </>}
                    {status && <div className="vcd-status">{status}</div>}
                </section>
            </main>
        </div>
    </div>;
}

export default definePlugin({
    name: "VCDashboard",
    description: "A local-first Discord workspace with notes, tasks, folders, global search, recycle bin, links, clipboard snippets, file storage and backups.",
    authors: [{ name: "Sushi", id: 0n }],
    chatBarButton: {
        icon: DashboardIcon,
        render: DashboardButton
    }
});
