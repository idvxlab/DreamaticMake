import { t, useLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Layers3, Settings, LayoutDashboard } from "lucide-react";
import { version } from "../../../../package.json";
export function BrandMenu({
  onSettings,
  onWorkbench,
}: {
  onSettings: () => void;
  onWorkbench: () => void;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (!area.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    area.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="brand-area" ref={area}>
      <button
        ref={trigger}
        className="brand brand-trigger"
        aria-label={t("DreamaticMake 菜单")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "brand-menu" : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <div className="brand-icon">
          <Layers3 size={21} />
        </div>
        <div>
          <strong>
            Dreamatic<span>Make</span>
          </strong>
          <small>IDEAS INTO OBJECTS</small>
        </div>
        <ChevronDown size={14} className="brand-chevron" />
      </button>
      {open && (
        <div
          id="brand-menu"
          className="brand-menu"
          role="menu"
          aria-label={t("DreamaticMake 菜单")}
          onKeyDown={(e) => {
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const items = [
                ...e.currentTarget.querySelectorAll<HTMLElement>(
                  '[role="menuitem"]',
                ),
              ];
              const current = items.indexOf(
                document.activeElement as HTMLElement,
              );
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? items.length - 1
                    : (current +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
            if (e.key === "Tab") setOpen(false);
          }}
        >
          <div className="brand-menu-heading" role="presentation">
            <span>Dreamatic·Make</span>
            <span>v{version}</span>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              onWorkbench();
            }}
          >
            <LayoutDashboard size={19} />
            <span>{t("工作台")}</span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              onSettings();
            }}
          >
            <Settings size={19} />
            <span>{t("系统设置")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
