#!/usr/bin/env python3
"""rolodex-export.py [snapshot.sqlite] — print the Rolodex's WhatsApp cache JSON (spec rolodex §4) from a siso-contact snapshot.

Runs on siso-vps through tools/rolodex-pull (`ssh siso-vps python3 - < rolodex-export.py`), or locally with a path.
Opens the snapshot read-only (mode=ro). DMs only. One row per personal chat: chatId, displayName, labels, lastContacted
(unix seconds), messageCount. Never selects a message body: the only things read from `messages` are its chat id and time.
Python 3 stdlib only. Column names are looked up rather than assumed, so a renamed column fails loudly, not silently.
"""
import datetime, json, sqlite3, sys

DEFAULT = "/opt/siso-contact/data/snapshot.sqlite"


def columns(db, table):
    return [r[1] for r in db.execute(f"PRAGMA table_info({table})")]


def pick(cols, *names):
    for n in names:
        if n in cols:
            return n
    return None


def need(table, col, what):
    if not col:
        sys.exit(f"rolodex-export: {table} has no {what} column")
    return col


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "chats" not in tables:
        sys.exit("rolodex-export: no chats table")
    cc = columns(db, "chats")
    c_id = need("chats", pick(cc, "id", "chat_id", "jid"), "id")
    c_name = pick(cc, "name", "display_name", "contact_name", "formatted_title")
    c_group = pick(cc, "is_group", "isGroup")
    c_last = pick(cc, "last_message_at", "timestamp", "t", "last_ts")
    name_sql = f"COALESCE(c.{c_name}, '')" if c_name else "''"
    group_sql = f"c.{c_group} = 0" if c_group else "1"

    labels = {}
    if "contact_labels" in tables:
        lc = columns(db, "contact_labels")
        l_id = need("contact_labels", pick(lc, "id", "contact_id", "jid"), "id")
        l_label = need("contact_labels", pick(lc, "label", "name"), "label")
        for cid, label in db.execute(f"SELECT {l_id}, {l_label} FROM contact_labels WHERE {l_label} IS NOT NULL AND {l_label} != ''"):
            labels.setdefault(str(cid), []).append(str(label))

    counts = {}
    if "messages" in tables:
        mc = columns(db, "messages")
        m_chat = need("messages", pick(mc, "chat_id", "chat", "jid", "chatId"), "chat id")
        m_ts = pick(mc, "timestamp", "ts", "t", "created_at")
        ts_sql = f"MAX({m_ts})" if m_ts else "NULL"
        # Only the chat id and the time: never the body.
        for chat, n, last in db.execute(f"SELECT {m_chat}, COUNT(*), {ts_sql} FROM messages GROUP BY {m_chat}"):
            counts[str(chat)] = (n, last)

    contacts = []
    rows = db.execute(f"SELECT c.{c_id}, {name_sql}{', c.' + c_last if c_last else ''} FROM chats c WHERE {group_sql} AND c.{c_id} NOT LIKE '%@g.us'")
    for row in rows:
        chat_id, name = str(row[0]), str(row[1] or "")
        last_col = row[2] if c_last else None
        # Labels joined by the full id and by the id's part before '@' (as read_rolodex does).
        bare = chat_id.split("@")[0]
        own = labels.get(chat_id, []) + ([l for l in labels.get(bare, [])] if bare != chat_id else [])
        own = list(dict.fromkeys(own))
        digits_only = name.replace("+", "").replace(" ", "").isdigit() or not name.strip()
        display = next((l for l in own if not l.replace("+", "").replace(" ", "").isdigit()), name) if digits_only else name
        n, last = counts.get(chat_id, (0, None))
        last = last if last is not None else last_col
        try:
            last = int(last) if last is not None else None
        except (TypeError, ValueError):
            last = None
        if last and last > 10**12:  # milliseconds
            last //= 1000
        contacts.append({"chatId": chat_id, "displayName": display or bare, "labels": own, "lastContacted": last, "messageCount": int(n)})

    harvested = None
    if "meta" in tables:
        mt = columns(db, "meta")
        k, v = pick(mt, "key", "name"), pick(mt, "value", "val")
        if k and v:
            for (val,) in db.execute(f"SELECT {v} FROM meta WHERE {k} = 'harvested_at'"):
                harvested = str(val)
    source = ("siso-vps:" if path == DEFAULT else "local:") + path
    pulled = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    json.dump({"source": source, "harvestedAt": harvested, "pulledAt": pulled, "contacts": contacts}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
