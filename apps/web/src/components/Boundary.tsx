import { Component, type ErrorInfo, type ReactNode } from "react";
import "./Boundary.css";

/**
 * One part of the app that failed to draw, kept to that part (QA #13, A0, 3 Oct: one malformed field, /api/spend's
 * owners as an object, blanked the whole app because nothing caught it). A space, a page, the side nav or one card
 * shows what broke and a Try again; everything around it keeps working. A new `resetKey` (another space, another
 * agent) clears it.
 */
type Props = { name: string; kind?: "space" | "card" | "inline"; resetKey?: unknown; /** Its part is not on screen: no fallback either. */ hidden?: boolean; children: ReactNode };
type State = { error: Error | null; key: unknown };

export class Boundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} could not draw:`, error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { name, kind = "space", hidden } = this.props;
    if (hidden) return null;
    const retry = (
      <button type="button" className="ab-boundary__retry" onClick={() => this.setState({ error: null })}>
        Try again
      </button>
    );
    if (kind === "inline")
      return (
        <span className="ab-boundary is-inline" role="alert" data-testid="boundary" data-name={name} title={error.message}>
          {name} failed {retry}
        </span>
      );
    return (
      <section className={`ab-boundary is-${kind}`} role="alert" data-testid="boundary" data-name={name}>
        <b>{name} could not be shown</b>
        <p>{error.message || String(error)}</p>
        {retry}
      </section>
    );
  }
}
