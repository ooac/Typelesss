import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface ProviderRowProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  status?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  expanded?: boolean;
}

export function ProviderRow({
  icon,
  label,
  value,
  status,
  onClick,
  disabled,
  expanded = false,
}: ProviderRowProps) {
  const interactive = Boolean(onClick) && !disabled;
  return (
    <button
      type="button"
      className={`provider-row ${interactive ? "" : "is-static"}`}
      onClick={onClick}
      disabled={!interactive}
    >
      <span className="provider-row__icon">{icon}</span>
      <div className="provider-row__main">
        <span className="provider-row__label">{label}</span>
        <span className="provider-row__value">{value}</span>
      </div>
      <div className="provider-row__tail">
        {status ? <div className="provider-row__status">{status}</div> : null}
        {interactive ? (
          <ChevronRight
            size={18}
            className={`provider-row__chevron ${expanded ? "is-expanded" : ""}`}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </button>
  );
}
