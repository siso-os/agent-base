import { useCallback, useEffect, useMemo, useState } from "react";
import { BookUser, MessageCircle, Smartphone } from "lucide-react";
import { bus } from "../../os/registry";
import { useRolodexBook } from "./people/book";
import { PeopleSpace, type PeoplePane } from "./PeopleSpace";
import { setComms, useComms } from "./tab";
import { WhatsAppSpace, type WaPeopleLink, type WaPerson } from "./WhatsAppSpace";
import "./Comms.css";

/** Communications (siso-os.md §5, Agency; Shaan, 10 Oct: "Merge Rolodex and WhatsApp ... I like the WhatsApp UI quite a lot"):
 *  his chats and the people in them, one space. A WhatsApp-style strip on the left switches Chats and People; a chat shows its
 *  person's level and opens their page, a person's page opens their chat. Private: never mirrored. */
export default function CommsModule() {
  const comms = useComms();
  const tab = comms.tab;
  const book = useRolodexBook(true);
  const [waOn, setWaOn] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/whatsapp/config", { cache: "no-store" }).then((r) => r.json()).then((c) => setWaOn(!!c?.configured)).catch(() => setWaOn(false));
  }, []);
  // Both halves stay mounted after their first visit, so switching back is instant and keeps the open chat or person.
  const [seen, setSeen] = useState({ chats: true, people: tab === "people" });
  useEffect(() => { setSeen((s) => (s[tab] ? s : { ...s, [tab]: true })); }, [tab]);
  const [pane, setPane] = useState<PeoplePane>(comms.person ? { kind: "person", id: comms.person } : { kind: "home" });
  useEffect(() => { if (comms.person) setPane({ kind: "person", id: comms.person }); }, [comms.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [unread, setUnread] = useState(0);

  const byKey = useMemo(() => {
    const m = new Map<string, WaPerson>();
    for (const p of book.data?.people ?? []) if (p.level !== "off") for (const k of p.keys) m.set(k, { id: p.id, name: p.name, level: p.level });
    return m;
  }, [book.data]);
  const people = useMemo<WaPeopleLink>(() => ({
    byKey,
    onPerson: (id) => setComms({ tab: "people", person: id }),
    place: async (key, level) => { await book.act({ op: "place", key, level }); },
  }), [byKey, book.act]); // eslint-disable-line react-hooks/exhaustive-deps
  const openKey = comms.chatKey ? { key: comms.chatKey, nonce: comms.nonce } : undefined;
  const onAsk = useCallback((words: string) => bus.runCommand("ask-a0", words), []);

  const go = (t: "chats" | "people") => setComms({ tab: t });
  return (
    <section className="wa-comms relative flex min-w-0 flex-1" aria-label="Communications" data-tab={tab}>
      <nav className="wa-strip" aria-label="Communications">
        <button type="button" className="wa-strip-btn" aria-pressed={tab === "chats"} data-tab="chats" onClick={() => go("chats")} title="Chats: your WhatsApp">
          <MessageCircle size={20} aria-hidden="true" />{unread > 0 && <b aria-label={`${unread} unread chats`}>{unread > 99 ? "99+" : unread}</b>}<span>Chats</span>
        </button>
        <button type="button" className="wa-strip-btn" aria-pressed={tab === "people"} data-tab="people" onClick={() => go("people")} title="People: your Rolodex, on six levels">
          <BookUser size={20} aria-hidden="true" />{!!book.data?.inbox.length && <b aria-label={`${book.data.inbox.length} chats to sort`}>{book.data.inbox.length > 99 ? "99+" : book.data.inbox.length}</b>}<span>People</span>
        </button>
      </nav>
      {seen.chats && <div className="wa-comms-pane" hidden={tab !== "chats"}>
        {waOn === false ? <div className="wa-space"><div /><main className="wa-main"><div className="wa-center"><Smartphone size={26} aria-hidden="true" />
          <p>WhatsApp isn't set up on this Mac, so there are no chats to show.</p>
          <button type="button" className="wa-strip-link" onClick={() => go("people")}>Open People</button></div></main></div>
          : waOn && <WhatsAppSpace people={people} openKey={openKey} onUnread={setUnread} />}
      </div>}
      {seen.people && <div className="wa-comms-pane" hidden={tab !== "people"}>
        <PeopleSpace book={book} pane={pane} onPane={setPane} active={tab === "people"} onAsk={onAsk}
          onOpenChat={(key) => setComms({ tab: "chats", chatKey: key })} />
      </div>}
    </section>
  );
}
