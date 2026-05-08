import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface DrawerProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, title, description, onClose, children, footer }: DrawerProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    contentRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="drawer-portal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drawer__overlay" onClick={onClose} />
      <aside className="drawer" ref={contentRef} tabIndex={-1}>
        <header className="drawer__header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer ? <footer className="drawer__footer">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}
