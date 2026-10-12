/**
 * Stub Questions module: what the agents need you to answer.
 * The agent base: Questions module (t-0599, spec §2a item 1).
 */
export default function QuestionsModule() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-base font-semibold">Questions</h2>
      <p className="text-sm text-muted-foreground">What the agents need you to answer will gather here.</p>
    </div>
  );
}
