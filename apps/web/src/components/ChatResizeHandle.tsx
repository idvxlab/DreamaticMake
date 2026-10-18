import { useRef, useState } from "react";
import { t } from "../i18n";

export function readChatWidth(): number | undefined {
  try {
    const width = Number(localStorage.getItem("make-chat-width"));
    return width >= 300 && width <= 800 ? width : undefined;
  } catch {
    return undefined;
  }
}

export function ChatResizeHandle({
  onResize,
}: {
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function resize(element: HTMLElement, width: number) {
    const sidebar =
      element
        .closest(".app-shell")
        ?.querySelector(".sidebar")
        ?.getBoundingClientRect().width ?? 236;
    const maximum = Math.min(
      800,
      window.innerWidth - sidebar - (window.innerWidth > 950 ? 320 : 0),
    );
    const next = Math.round(
      Math.max(Math.min(300, maximum), Math.min(maximum, width)),
    );
    onResize(next);
    try {
      localStorage.setItem("make-chat-width", String(next));
    } catch {
      /* Storage may be unavailable. */
    }
  }
  return (
    <div
      className={`chat-resize-handle${dragging ? " dragging" : ""}`}
      role="separator"
      aria-label={t("调整聊天助手宽度")}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = {
          x: event.clientX,
          width:
            event.currentTarget.parentElement!.getBoundingClientRect().width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            event.currentTarget,
            drag.current.width + drag.current.x - event.clientX,
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        resize(
          event.currentTarget,
          event.currentTarget.parentElement!.getBoundingClientRect().width +
            (event.key === "ArrowLeft" ? 20 : -20),
        );
      }}
    />
  );
}
