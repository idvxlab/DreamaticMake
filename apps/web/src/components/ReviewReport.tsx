import { Check, AlertTriangle } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage";
import { t } from "../i18n";
import type { Stage } from "../../../../packages/core/src/contracts";

export function ReviewReport({
  review,
}: {
  review: NonNullable<Stage["review"]>;
}) {
  const passed = review.verdict === "pass";
  return (
    <section
      className={`review-report ${review.verdict}`}
      aria-label={t("独立工程审阅")}
    >
      <header>
        <span className="review-report-icon">
          {passed ? <Check size={16} /> : <AlertTriangle size={16} />}
        </span>
        <strong>{t("独立工程审阅")}</strong>
        <span className="review-report-status">
          {t(passed ? "审阅通过" : "待系统完善")}
        </span>
      </header>
      <MarkdownMessage text={review.summary} card />
      {review.engineVerification && (
        <details>
          <summary>{t("引擎验证记录")}</summary>
          <ul>
            {review.engineVerification.checks.map((check) => (
              <li key={check.id}>
                {check.passed ? "✓" : "✗"} {check.id}：{check.reason}
              </li>
            ))}
          </ul>
          {review.engineVerification.limitations.map((limitation, index) => (
            <MarkdownMessage key={index} text={limitation} card />
          ))}
        </details>
      )}
    </section>
  );
}
