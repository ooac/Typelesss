import type { ReactNode } from "react";
import type { PermissionState } from "../appTypes.js";

interface PermissionCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  status: PermissionState;
  detail?: string;
  actions?: ReactNode;
}

const STATUS_LABEL: Record<PermissionState, string> = {
  granted: "已授权",
  denied: "未授权",
  unknown: "未检测",
};

export function PermissionCard({
  icon,
  title,
  description,
  status,
  detail,
  actions,
}: PermissionCardProps) {
  return (
    <article className="permission-card">
      <div className="permission-card__icon">{icon}</div>
      <div className="permission-card__copy">
        <h3>{title}</h3>
        <p>{description}</p>
        <span className={`permission-card__status ${status}`}>{STATUS_LABEL[status]}</span>
        {detail ? <p className="permission-card__detail">{detail}</p> : null}
      </div>
      {actions ? <div className="permission-card__actions">{actions}</div> : null}
    </article>
  );
}
