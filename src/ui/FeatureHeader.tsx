import { type ReactNode } from "react";
import "./FeatureHeader.css";

type FeatureHeaderMetric = {
  label: string;
  value: string;
  positive?: boolean;
};

export function FeatureHeader({
  eyebrow,
  title,
  accent,
  subtitle,
  metrics = [],
  actions,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  subtitle: string;
  metrics?: FeatureHeaderMetric[];
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`v2-greet${compact ? " compact" : ""}`}>
      <div className="v2-greet-l">
        <div className="v2-greet-time mono">{eyebrow}</div>
        <div className="v2-greet-hi">
          {title}
          <span className="v2-greet-name">{accent}</span>
        </div>
        <div className="v2-greet-sub">{subtitle}</div>
      </div>
      {(metrics.length > 0 || actions) && (
        <div className="v2-greet-r">
          {metrics.map((metric) => (
            <div className="v2-greet-stat" key={metric.label}>
              <div className="mono">{metric.label}</div>
              <div
                className={`v2-greet-num${metric.positive ? " positive" : ""}`}
              >
                {metric.value}
              </div>
            </div>
          ))}
          {actions}
        </div>
      )}
    </div>
  );
}
