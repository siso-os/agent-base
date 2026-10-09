/**
 * Voice settings, lifted from SISO Internal's VoiceSettingsComposer: transcription (model, language, live
 * streaming), behaviour switches, and the record. Each change writes one SISO Voice preference through the node,
 * optimistically, and rolls back if the node refuses. SISO Voice reads these at launch (AppState), so they apply
 * when it relaunches; the page says so. Shortcuts, launch at login and the microphone stay in SISO Voice itself.
 */
import { cn } from "@siso/shell";
import { RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useVoiceSettings, voiceWrites, type VoicePrefs, type VoiceSource } from "./api";
import { formatGrouped, timeAgo } from "./format";
import { Card, Select, SettingRow, Switch } from "./ui";

const MODEL_LABEL: Record<string, string> = {
  "whisper-large-v3": "Whisper Large v3",
  "whisper-large-v3-turbo": "Whisper Large v3 Turbo",
  "distil-whisper-large-v3-en": "Distil-Whisper v3 (English)",
  "gpt-4o-transcribe": "GPT-4o Transcribe",
  "gpt-4o-mini-transcribe": "GPT-4o Mini Transcribe",
  "": "Provider default",
};
const LANGUAGE_LABEL: Record<string, string> = { "": "Detect", en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", hi: "Hindi" };

const mb = (n?: number) => (n == null ? "—" : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function VoiceSettings({ source, className }: { source?: VoiceSource; className?: string }) {
  const { data, error } = useVoiceSettings(source);
  const w = voiceWrites(source);
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<Partial<Record<keyof VoicePrefs, boolean>>>({});
  const pending = useRef(new Set<keyof VoicePrefs>());

  useEffect(() => {
    if (data) setPrefs(data.prefs);
  }, [data]);

  const set = async <K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]) => {
    if (!prefs || pending.current.has(key)) return;
    const before = prefs[key];
    pending.current.add(key);
    setPendingKeys((p) => ({ ...p, [key]: true }));
    setWriteError(null);
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    try {
      await w.setPref(key, value);
      setChanged(true);
    } catch (e) {
      setPrefs((p) => (p ? { ...p, [key]: before } : p));
      setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current.delete(key);
      setPendingKeys((p) => ({ ...p, [key]: false }));
    }
  };

  const opts = (list: string[] | undefined, labels: Record<string, string>) => (list ?? []).map((v) => ({ value: v, label: labels[v] ?? v }));
  const off = !prefs;

  return (
    <div className={cn("flex flex-col gap-4", className)} data-voice="settings">
      {error && <p className="text-[13px] text-muted-foreground">Voice is not answering: {error}</p>}
      {writeError && (
        <p role="alert" className="rounded-[9px] border border-failed/25 bg-failed/10 px-3 py-2 text-[12.5px] text-failed">
          {writeError}
        </p>
      )}
      {changed && (
        <p role="status" className="flex items-center gap-2 rounded-[9px] border border-needs/25 bg-needs/10 px-3 py-2 text-[12.5px] text-needs">
          <RotateCw className="h-3.5 w-3.5" aria-hidden /> Saved. Agent Base uses it on your next dictation; SISO Voice when it relaunches.
        </p>
      )}

      <Card title="Transcription" sub="Who turns speech into text.">
        <div className="divide-y divide-border">
          <SettingRow label="Model" hint="For the old SISO Voice app; Agent Base always uses Whisper Large v3 Turbo">
            <Select label="Transcription model" disabled={off || !!pendingKeys.transcription_model} value={prefs?.transcription_model ?? ""} options={opts(data?.options.transcription_model, MODEL_LABEL)} onChange={(v) => void set("transcription_model", v)} />
          </SettingRow>
          <SettingRow label="Language" hint="Detect lets the model decide">
            <Select label="Language" disabled={off || !!pendingKeys.transcription_language} value={prefs?.transcription_language ?? ""} options={opts(data?.options.transcription_language, LANGUAGE_LABEL)} onChange={(v) => void set("transcription_language", v)} />
          </SettingRow>
          <SettingRow label="Live streaming" hint="Show words while you are still speaking">
            <Switch label="Live streaming" disabled={off || !!pendingKeys.realtime_streaming_enabled} checked={prefs?.realtime_streaming_enabled ?? false} onChange={(v) => void set("realtime_streaming_enabled", v)} />
          </SettingRow>
          {prefs?.realtime_streaming_enabled && (
            <SettingRow label="Streaming model">
              <Select label="Streaming model" disabled={!!pendingKeys.realtime_streaming_model} value={prefs.realtime_streaming_model} options={opts(data?.options.realtime_streaming_model, MODEL_LABEL)} onChange={(v) => void set("realtime_streaming_model", v)} />
            </SettingRow>
          )}
        </div>
      </Card>

      <Card title="Behaviour">
        <div className="divide-y divide-border">
          <SettingRow label="Keep my clipboard" hint="Put back what you had copied after a dictation is pasted">
            <Switch label="Keep my clipboard" disabled={off || !!pendingKeys.preserve_clipboard} checked={prefs?.preserve_clipboard ?? true} onChange={(v) => void set("preserve_clipboard", v)} />
          </SettingRow>
          <SettingRow label="Sounds" hint="A cue when capture starts and stops">
            <Switch label="Sounds" disabled={off || !!pendingKeys.alert_sounds_enabled} checked={prefs?.alert_sounds_enabled ?? true} onChange={(v) => void set("alert_sounds_enabled", v)} />
          </SettingRow>
          <SettingRow label="Command mode" hint="Old SISO Voice app only; Agent Base does not edit selected text yet">
            <Switch label="Command mode" disabled={off || !!pendingKeys.command_mode_enabled} checked={prefs?.command_mode_enabled ?? false} onChange={(v) => void set("command_mode_enabled", v)} />
          </SettingRow>
          <SettingRow label="Edge dock" hint="The old SISO Voice app's dock on the right edge">
            <Switch label="Edge dock" disabled={off || !!pendingKeys.edge_dock_enabled} checked={prefs?.edge_dock_enabled ?? true} onChange={(v) => void set("edge_dock_enabled", v)} />
          </SettingRow>
          <SettingRow label="Microphone" hint="The Mac's default input; change it in System Settings → Sound">
            <span className="font-mono text-3xs uppercase tracking-[0.14em] text-muted-foreground">system</span>
          </SettingRow>
        </div>
      </Card>

      <Card title="The record" sub="SISO Voice's history store, read here and never written. Agent Base keeps its own beside it.">
        <div className="divide-y divide-border">
          <SettingRow label="Dictations">
            <span className="font-mono text-[12px] tabular-nums text-secondary-label">{data ? (data.db.present ? formatGrouped(data.db.entries ?? 0) : "not on this machine") : "—"}</span>
          </SettingRow>
          <SettingRow label="Size">
            <span className="font-mono text-[12px] tabular-nums text-secondary-label">{mb(data?.db.sizeBytes)}</span>
          </SettingRow>
          <SettingRow label="Last written">
            <span className="font-mono text-[12px] tabular-nums text-secondary-label">{data?.db.mtime ? timeAgo(data.db.mtime) : "—"}</span>
          </SettingRow>
        </div>
      </Card>
    </div>
  );
}
