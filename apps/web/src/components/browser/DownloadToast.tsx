// uihub: arc:toast-stack (renders in the one stack, t-0460)
import { FileIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fileSize } from "../../lib/browser-downloads";
import { Toast } from "../ToastStack";

export type Finished = { id: number; name: string; agent: string | null; ok: boolean };
const post = (route: string, body: unknown) => fetch(`/api/browser/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

/** A finished download, for 6 s above the space bar (arc-edges §5.5): file icon, name, size, Show and Open. It stays while
 * the pointer is on it. Open is offered only for a document, picture, sound or video (the node's canOpen); anything else
 * is shown in Finder. */
export function DownloadToast(props: { done: Finished; onShow: () => void; onError: (text: string) => void; onClose: () => void }) {
  const d = props.done;
  const [info, setInfo] = useState<{ size: number; canOpen: boolean } | null>(null);
  const timer = useRef(0);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const wait = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => close.current(), 6000); };
  useEffect(() => {
    setInfo(null);
    wait();
    if (d.ok) void post("download-info", { name: d.name, agent: d.agent }).then((r) => (r?.ok ? r.json() : null)).then((i) => setInfo(typeof i?.size === "number" ? i : null));
    return () => clearTimeout(timer.current);
  }, [d.id]);
  const open = async () => {
    const r = await post("open-download", { name: d.name, agent: d.agent });
    if (!r?.ok) props.onError(r?.status === 404 ? `${d.name} is no longer in Downloads.` : `Could not open ${d.name}.`);
    props.onClose();
  };
  const where = d.agent ? `Downloads/Agents/${d.agent}` : "Downloads";
  return (
    <Toast kind="download"><div className="ab-browser__toast" role="status" aria-label={d.ok ? `Downloaded ${d.name}` : `Download of ${d.name} failed`} data-ok={d.ok || undefined} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={wait}>
      <FileIcon size={16} aria-hidden="true" />
      <span><b title={d.name}>{d.name}</b><small>{d.ok ? `${info ? `${fileSize(info.size)} · ` : ""}${where}` : "Download failed"}</small></span>
      <button type="button" className="ab-browser__toast-x" aria-label="Dismiss" onClick={props.onClose}>×</button>
      {d.ok && <span className="ab-browser__toast-acts">
        <button type="button" onClick={() => { props.onShow(); props.onClose(); }}>Show</button>
        {info?.canOpen && <button type="button" onClick={() => void open()}>Open</button>}
      </span>}
    </div></Toast>
  );
}
