import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Keeps a failed terminal chunk local to its terminal slot; a rejected React.lazy promise cannot be retried in place. */
export class TerminalLoadBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground" role="alert">
        <span>Terminal could not load.</span>
        <button type="button" className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-raised" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
