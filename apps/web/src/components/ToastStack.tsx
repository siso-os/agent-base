// uihub: arc:toast-stack — one stack at the window's edge for every pop-up (t-0460): owner notes, the shipped card and
// downloads used to sit in three places. arc's shape (newest at the bottom, a short rise in, still under reduced motion)
// in CSS alone: no motion library in an app we are making lighter (t-0571).
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import "./ToastStack.css";

const ID = "ab-toast-stack";
function stack(): HTMLElement {
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement("ol");
    el.id = ID;
    el.className = "ab-toast-stack";
    el.dataset.testid = "toast-stack";
    el.setAttribute("aria-label", "Notifications");
    // Five at once would climb over the composer: the newest three show, the stack says how many more (hover shows all).
    const count = (stack: HTMLElement) => () => {
      const more = stack.children.length - 3;
      if (more > 0) stack.dataset.more = String(more); else delete stack.dataset.more;
    };
    new MutationObserver(count(el)).observe(el, { childList: true });
    document.body.appendChild(el);
  }
  return el;
}

/** One pop-up in the stack; it keeps its own content, timing and actions. */
export function Toast({ children, kind }: { children: ReactNode; kind: string }) {
  return createPortal(<li className="ab-toast" data-toast={kind}>{children}</li>, stack());
}
