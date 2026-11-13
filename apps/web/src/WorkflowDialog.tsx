import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(close);
  cb.current = close;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null,
      old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cb.current();
      }
      if (e.key === "Tab") {
        const a = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),details > summary:first-of-type",
          ) || []),
        ].filter((x) => x.getClientRects().length);
        if (!a.length) {
          e.preventDefault();
          return;
        }
        const i = a.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          a.at(-1)?.focus();
        } else if (!e.shiftKey && (i < 0 || i === a.length - 1)) {
          e.preventDefault();
          a[0].focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.body.style.overflow = old;
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return createPortal(
    <div
      className="wf-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="wf-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <strong>{title}</strong>
          <button onClick={close} aria-label="关闭">
            关闭
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
