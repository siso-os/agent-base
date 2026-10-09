import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronDownIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, MoreHorizontalIcon } from "lucide-react";
import { canMoveBrowserFolder, moveBrowserFolder, removeBrowserFolder, safeFolderPin, type BrowserFolder } from "../../lib/browser-tabs";

type Pin = { url: string; title: string };
const FOLDER_DRAG = "application/x-ab-folder";
const PIN_DRAG = "application/x-ab-pin", TODAY_DRAG = "application/x-ab-today";
/** Folder metadata references existing pins. A folder never owns a profile or a website store. */
export function SavedFolders({ space, folders, pins, onFolders, onFile, renderPin }: {
  space: string; folders: BrowserFolder[]; pins: Pin[];
  onFolders: (next: BrowserFolder[]) => void;
  onFile: (pin: Pin, folderId?: string) => void;
  renderPin: (pin: Pin) => ReactNode;
}) {
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<string>();
  const [edit, setEdit] = useState<{ id?: string; parentId?: string; name: string }>();
  const [error, setError] = useState("");
  const [over, setOver] = useState<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const rows = folders.filter((f) => f.space === space);
  const assigned = new Set(rows.flatMap((f) => f.urls));
  const startEdit = (next: NonNullable<typeof edit>) => { setEdit(next); setError(""); setMenu(undefined); };
  const accept = (e: DragEvent, folderId?: string) => {
    e.preventDefault(); e.stopPropagation(); setOver(undefined);
    try {
      const folder = e.dataTransfer.getData(FOLDER_DRAG);
      if (folder) { const moving = JSON.parse(folder); if (moving.space === space) onFolders(moveBrowserFolder(folders, moving.id, folderId)); return; }
      const raw = e.dataTransfer.getData(PIN_DRAG) || e.dataTransfer.getData(TODAY_DRAG);
      if (!raw) return;
      const pin: unknown = JSON.parse(raw);
      if (safeFolderPin(pin)) onFile(pin, folderId);
    } catch { /* Ignore malformed/external drags, never interpret them as saved data. */ }
  };
  const dragOver = (e: DragEvent, id = "root") => {
    if (![FOLDER_DRAG, PIN_DRAG, TODAY_DRAG].some((type) => e.dataTransfer.types.includes(type))) return;
    e.preventDefault(); e.stopPropagation(); setOver(id); e.dataTransfer.dropEffect = "move";
  };
  const reorder = (id: string, direction: number) => {
    const row = rows.find((f) => f.id === id)!;
    const siblings = rows.filter((f) => f.parentId === row.parentId);
    const other = siblings[siblings.findIndex((f) => f.id === id) + direction];
    if (!other) return;
    const next = [...folders], a = next.findIndex((f) => f.id === id), b = next.findIndex((f) => f.id === other.id);
    [next[a], next[b]] = [next[b], next[a]]; onFolders(next);
  };
  const tree = (parentId?: string): ReactNode => rows.filter((f) => f.parentId === parentId).map((folder) => {
    const children = folder.urls.flatMap((url) => { const pin = pins.find((p) => p.url === url); return pin ? [pin] : []; });
    const siblings = rows.filter((f) => f.parentId === parentId), index = siblings.findIndex((f) => f.id === folder.id);
    return <div className="ab-browser__folder" key={folder.id} data-folder={folder.id} data-drop={over === folder.id || undefined}>
      <div className="ab-browser__folder-row" data-selected={selected === folder.id || undefined} draggable
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData(FOLDER_DRAG, JSON.stringify({ id: folder.id, space })); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => dragOver(e, folder.id)} onDrop={(e) => accept(e, folder.id)}
        onContextMenu={(e) => { e.preventDefault(); setMenu(folder.id); }}>
        <button type="button" className="ab-browser__folder-toggle" aria-label={`${folder.collapsed ? "Expand" : "Collapse"} ${folder.name}`} aria-expanded={!folder.collapsed}
          onClick={() => onFolders(folders.map((f) => f.id === folder.id ? { ...f, collapsed: !f.collapsed } : f))}><ChevronDownIcon size={12} /></button>
        <button type="button" className="ab-browser__folder-label" aria-label={`Folder: ${folder.name}`} title={folder.name} aria-pressed={selected === folder.id} onClick={() => setSelected(folder.id)}>
          {folder.collapsed ? <FolderIcon size={15} /> : <FolderOpenIcon size={15} />}<span>{folder.name}</span><small>{children.length}</small>
        </button>
        <button type="button" className="ab-browser__folder-options" aria-label={`Options for ${folder.name}`} aria-haspopup="dialog" aria-expanded={menu === folder.id} onClick={() => setMenu(menu === folder.id ? undefined : folder.id)}><MoreHorizontalIcon size={14} /></button>
      </div>
      {menu === folder.id && <div className="ab-browser__folder-menu" role="dialog" aria-label={`Folder options: ${folder.name}`} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setMenu(undefined); } }}>
        <button type="button" onClick={() => startEdit({ id: folder.id, name: folder.name })}>Rename folder</button>
        <button type="button" onClick={() => startEdit({ parentId: folder.id, name: "" })}>New subfolder</button>
        <label>Move to<select aria-label={`Move ${folder.name} to`} value={folder.parentId ?? ""} onChange={(e) => { onFolders(moveBrowserFolder(folders, folder.id, e.target.value || undefined)); setMenu(undefined); }}>
          <option value="">Top level</option>{rows.filter((f) => canMoveBrowserFolder(folders, folder.id, f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <div className="ab-browser__folder-order"><button type="button" disabled={index === 0} onClick={() => reorder(folder.id, -1)}>Move up</button><button type="button" disabled={index === siblings.length - 1} onClick={() => reorder(folder.id, 1)}>Move down</button></div>
        <button type="button" onClick={() => { onFolders(removeBrowserFolder(folders, folder.id)); setMenu(undefined); }}>Remove folder; keep pages</button>
        <button type="button" onClick={() => setMenu(undefined)}>Done</button>
      </div>}
      {!folder.collapsed && <div className="ab-browser__folder-children">
        {tree(folder.id)}{children.map((pin) => <div key={pin.url}>{renderPin(pin)}</div>)}
        {!children.length && !rows.some((f) => f.parentId === folder.id) && <p className="ab-browser__folder-empty" onDragOver={(e) => dragOver(e, folder.id)} onDrop={(e) => accept(e, folder.id)}>Drop a saved page here</p>}
      </div>}
    </div>;
  });
  return <div className="ab-browser__saved" onDragEnd={() => setOver(undefined)} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(undefined); }}>
    <div className="ab-browser__saved-head" data-drop={over === "root" || undefined} onDragOver={(e) => dragOver(e)} onDrop={(e) => accept(e)}>
      <span>Pinned</span><button ref={addButton} type="button" aria-label="New folder" title="New folder" onClick={() => startEdit({ name: "" })}><FolderPlusIcon size={15} /></button>
    </div>
    {edit && <form className="ab-browser__folder-edit" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEdit(undefined); addButton.current?.focus(); } }} onSubmit={(e) => {
      e.preventDefault(); const name = edit.name.trim(); if (!name) { setError("Give the folder a name."); return; }
      if (rows.some((f) => f.id !== edit.id && f.parentId === (edit.id ? rows.find((r) => r.id === edit.id)?.parentId : edit.parentId) && f.name.toLowerCase() === name.toLowerCase())) { setError("A folder here already has that name."); return; }
      const id = edit.id ?? `folder-${crypto.randomUUID()}`;
      const next = edit.id ? folders.map((f) => f.id === id ? { ...f, name } : f) : [...folders, { id, space, name, parentId: edit.parentId, collapsed: false, urls: [] }];
      if (!canMoveBrowserFolder(next, id, edit.id ? next.find((f) => f.id === id)?.parentId : edit.parentId)) { setError("Folders can be nested up to eight levels."); return; }
      onFolders(next.map((f) => f.id === edit.parentId ? { ...f, collapsed: false } : f)); setSelected(id); setEdit(undefined); addButton.current?.focus();
    }}>
      <input autoFocus aria-label="Folder name" placeholder="Folder name" maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
      <div><button type="submit">Save folder</button><button type="button" onClick={() => setEdit(undefined)}>Cancel</button></div>{error && <p role="alert">{error}</p>}
    </form>}
    <div className="ab-browser__saved-list">{pins.filter((p) => !assigned.has(p.url)).map((p) => <div key={p.url}>{renderPin(p)}</div>)}{tree()}
      {!pins.length && !rows.length && <p className="ab-browser__empty">Pin a page or add a folder.</p>}
    </div>
  </div>;
}
