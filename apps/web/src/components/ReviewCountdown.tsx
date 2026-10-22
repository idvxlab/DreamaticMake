import { useEffect, useRef, useState } from "react";
import { t, useLanguage } from "../i18n";

/** One automatic repair per mounted review. Never submits an approval. */
export function ReviewCountdown({
  onContinue,
}: {
  onContinue: () => Promise<void>;
}) {
  useLanguage();
  const callback = useRef(onContinue);
  callback.current = onContinue;
  const fired = useRef(false);
  const [paused, setPaused] = useState(false);
  const [remaining, setRemaining] = useState(120);
  useEffect(() => {
    if (paused || fired.current) return;
    const deadline = Date.now() + 120000;
    setRemaining(120);
    const update = () => {
      const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds && !fired.current) {
        fired.current = true;
        clearInterval(timer);
        void callback.current();
      }
    };
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [paused]);
  return (
    <div className="approval-followups review-countdown">
      <span role="timer" aria-label={t("自动完善倒计时")}>
        {paused
          ? t("自动完善已暂停")
          : remaining
            ? t("{0} 秒后自动按审阅意见完善", { 0: remaining })
            : t("正在按审阅意见继续完善…")}
      </span>
      {!fired.current && (
        <button type="button" onClick={() => setPaused(!paused)}>
          {paused ? t("重新计时 120 秒") : t("暂停自动继续")}
        </button>
      )}
      <p>
        {t("倒计时结束后完善当前阶段；成果仍需你确认。补充意见会停止计时。")}
      </p>
    </div>
  );
}
