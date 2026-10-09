/**
 * Voice dictionary, lifted from SISO Internal's VoiceDictionaryComposer: the vocabulary the transcriber is told,
 * custom terms, and replacement rules (heard → write), with suggestions from history. Every change goes to SISO
 * Voice's own preferences through the node.
 *
 * What SISO Voice does with each (freeflow Sources, read 2 Oct): the vocabulary (custom_vocabulary) goes into every
 * cleanup pass and is read at launch; terms and rules are SISO Voice's Dictionary page record, which its pipeline does
 * not read yet (DictionaryStore.swift: "that wiring is a separate downstream task"). The page says so.
 */
import { cn } from "@siso/shell";
import { ArrowRight, BookOpenText, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useVoiceDictionary, voiceWrites, type VoiceRule, type VoiceSource, type VoiceTerm } from "./api";
import { timeAgo } from "./format";
import { Card, Count, Switch, inputClass, primaryButton } from "./ui";

const CORE_DATA_EPOCH_OFFSET = 978307200;

export function VoiceDictionary({ source, className }: { source?: VoiceSource; className?: string }) {
  const { data, error } = useVoiceDictionary(source);
  const w = voiceWrites(source);
  const [terms, setTerms] = useState<VoiceTerm[] | null>(null);
  const [rules, setRules] = useState<VoiceRule[] | null>(null);
  const [vocab, setVocab] = useState<string | null>(null);
  const [savedVocab, setSavedVocab] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setTerms(data.terms);
    setRules(data.rules);
    setVocab(data.vocabulary);
    setSavedVocab(data.vocabulary);
  }, [data]);

  const guard = async (fn: () => Promise<void>) => {
    setWriteError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addTerm = (text: string) =>
    guard(async () => {
      setTerms((await w.addTerm(text)).terms);
      setTerm("");
    });
  const onTerm = (e: FormEvent) => {
    e.preventDefault();
    if (term.trim()) void addTerm(term);
  };
  const onRule = (e: FormEvent) => {
    e.preventDefault();
    if (!from.trim()) return;
    void guard(async () => {
      setRules((await w.addRule(from, to)).rules);
      setFrom("");
      setTo("");
    });
  };
  const saveVocab = () =>
    guard(async () => {
      await w.setPref("custom_vocabulary", vocab ?? "");
      setSavedVocab(vocab);
      setSavedAt(Date.now());
    });

  const suggestions = (data?.suggestions ?? []).filter((s) => !(terms ?? []).some((t) => t.text.toLowerCase() === s.toLowerCase()));
  const vocabDirty = vocab !== null && vocab !== savedVocab;

  return (
    <div className={cn("flex flex-col gap-4", className)} data-voice="dictionary">
      {error && <p className="text-[13px] text-muted-foreground">Voice is not answering: {error}</p>}
      {writeError && (
        <p role="alert" className="rounded-[9px] border border-failed/25 bg-failed/10 px-3 py-2 text-[12.5px] text-failed">
          {writeError}
        </p>
      )}

      <Card title="Vocabulary" sub="Names and jargon the transcriber and the cleanup are told about, comma separated. Agent Base uses it on your next dictation.">
        <textarea
          value={vocab ?? ""}
          onChange={(e) => setVocab(e.target.value)}
          disabled={vocab === null}
          rows={3}
          spellCheck={false}
          maxLength={4000}
          aria-label="Vocabulary"
          placeholder={vocab === null ? "Reading…" : "SISO, herdr, Agent Base, Kellman…"}
          className={cn(inputClass, "w-full resize-y font-mono text-[12.5px] leading-relaxed")}
        />
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="text-[12px] text-muted-foreground">{vocabDirty ? "Unsaved" : savedAt ? `Saved ${timeAgo(new Date(savedAt).toISOString())}` : ""}</span>
          <button type="button" className={primaryButton} disabled={!vocabDirty || busy} onClick={() => void saveVocab()}>
            <Save className="h-3.5 w-3.5" aria-hidden /> Save
          </button>
        </div>
      </Card>

      <Card title="Spellings" sub="Names and words to always spell this way. Agent Base sends them with every dictation." right={<Count n={terms?.length} />}>
        <form className="mb-1 flex items-center gap-2" onSubmit={onTerm}>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Add a name or term…" aria-label="New term" maxLength={200} className={inputClass} />
          <button type="submit" disabled={!term.trim() || busy} className={primaryButton}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add
          </button>
        </form>
        {terms && terms.length > 0 ? (
          <div className="divide-y divide-border">
            {terms.map((t) => (
              <div key={t.id} className="group flex items-center gap-3 py-2.5">
                <BookOpenText className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
                <span className="select-text text-[13px] text-foreground">{t.text}</span>
                {t.addedAt != null && <span className="font-mono text-3xs text-muted-foreground">{timeAgo(new Date((t.addedAt + CORE_DATA_EPOCH_OFFSET) * 1000).toISOString())}</span>}
                <button
                  type="button"
                  onClick={() => void guard(async () => setTerms((await w.removeTerm(t.id)).terms))}
                  aria-label={`Delete ${t.text}`}
                  className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-failed focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : (
          terms && <p className="py-4 text-center text-[12.5px] text-muted-foreground">No terms yet.</p>
        )}
        {suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            <span className="mr-1 text-[11.5px] text-muted-foreground">Seen in history:</span>
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => void addTerm(s)} className="rounded-md border border-border px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-working/40 hover:text-working">
                + {s}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="Replacements" sub="Heard → write, for a word it always mishears. Agent Base applies them to every dictation." right={<Count n={rules?.length} />}>
        <form className="mb-1 flex flex-wrap items-center gap-2" onSubmit={onRule}>
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Heard…" aria-label="Replace this" maxLength={200} className={cn(inputClass, "font-mono text-[12.5px]")} />
          <ArrowRight className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Write… (empty removes it)" aria-label="With this" maxLength={200} className={cn(inputClass, "font-mono text-[12.5px]")} />
          <button type="submit" disabled={!from.trim() || busy} className={primaryButton}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add
          </button>
        </form>
        {rules && rules.length > 0 ? (
          <div className="divide-y divide-border">
            {rules.map((r) => (
              <div key={r.id} className={cn("group flex items-center gap-3 py-2.5", !r.enabled && "opacity-55")}>
                <span className="select-text font-mono text-[12.5px] text-foreground">{r.from}</span>
                <ArrowRight className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
                <span className="select-text font-mono text-[12.5px] text-foreground">{r.to || "—"}</span>
                <span className="ml-auto flex items-center gap-3">
                  <Switch checked={r.enabled} disabled={busy} label={`Use the rule for ${r.from}`} onChange={() => void guard(async () => setRules((await w.toggleRule(r.id)).rules))} />
                  <button
                    type="button"
                    onClick={() => void guard(async () => setRules((await w.removeRule(r.id)).rules))}
                    aria-label={`Delete the rule for ${r.from}`}
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-failed focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          rules && <p className="py-4 text-center text-[12.5px] text-muted-foreground">No replacements yet.</p>
        )}
      </Card>
    </div>
  );
}
