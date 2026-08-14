import { useState } from "react";
import type { QuestionLogItem, UiQuestion, UiQuestionAnswer, VsCodeApi } from "../types.js";
import { t } from "../../i18n.js";

function ResolvedQuestionBlock({
  index,
  total,
  prompt,
  answerText,
}: {
  index: number;
  total: number;
  prompt: string;
  answerText: string;
}) {
  return (
    <div className="question-block question-block-resolved">
      <div className="question-step-label">
        {t("Question {0} / {1}", index + 1, total)}
      </div>
      <div className="question-prompt">{prompt}</div>
      <div className="question-answer muted">{answerText}</div>
    </div>
  );
}

function ResolvedQuestionCard({ item }: { item: QuestionLogItem }) {
  const total = item.questions.length;
  const answersById = new Map((item.answers ?? []).map((a) => [a.questionId, a]));

  return (
    <div className="question-card resolved panel-enter msg-enter">
      {item.questions.map((q, i) => {
        const a = answersById.get(q.id);
        const parts = [...(a?.selectedLabels ?? []), ...(a?.freeText ? [a.freeText] : [])];
        const answerText = item.cancelled
          ? t("Cancelled — the run was stopped.")
          : parts.length
            ? parts.join(", ")
            : t("Skipped");
        return (
          <ResolvedQuestionBlock
            key={q.id}
            index={i}
            total={total}
            prompt={q.prompt}
            answerText={answerText}
          />
        );
      })}
    </div>
  );
}

function QuestionProgressDots({
  questions,
  step,
}: {
  questions: QuestionLogItem["questions"];
  step: number;
}) {
  return (
    <div className="question-progress">
      {questions.map((q, i) => (
        <span
          key={q.id}
          className={`question-progress-dot${i === step ? " active" : ""}${i < step ? " done" : ""}`}
          data-tooltip={t("Question {0}", i + 1)}
        />
      ))}
    </div>
  );
}

function QuestionOptionList({
  question,
  selectedIds,
  onToggle,
}: {
  question: UiQuestion;
  selectedIds: string[];
  onToggle: (optionId: string) => void;
}) {
  return (
    <div className="question-options">
      {question.options.map((o, i) => {
        const isSelected = selectedIds.includes(o.id);
        return (
          <button
            key={o.id}
            className={`btn question-option${isSelected ? " selected" : ""}`}
            onClick={() => onToggle(o.id)}
          >
            {o.label}
            {i === 0 && <span className="question-option-recommended">{t("(Recommended)")}</span>}
          </button>
        );
      })}
    </div>
  );
}

function QuestionNavigation({
  step,
  isLast,
  onBack,
  onNext,
  onSubmit,
}: {
  step: number;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="question-actions">
      <button className="btn" disabled={step === 0} onClick={onBack}>
        {t("Back")}
      </button>
      <div className="question-actions-right">
        {!isLast && (
          <>
            <button className="btn" onClick={onNext}>
              {t("Skip")}
            </button>
            <button className="btn primary" onClick={onNext}>
              {t("Next")}
            </button>
          </>
        )}
        <button className="btn primary" onClick={onSubmit}>
          {isLast ? t("Submit answers") : t("Submit now")}
        </button>
      </div>
    </div>
  );
}

function useActiveQuestionFlow(item: QuestionLogItem, vscode: VsCodeApi) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  const total = item.questions.length;
  const current = item.questions[step];
  const isLast = step >= total - 1;

  const toggleOption = (q: UiQuestion, optionId: string) => {
    setSelected((prev) => {
      const currentIds = prev[q.id] ?? [];
      if (q.allowMultiple) {
        const next = currentIds.includes(optionId)
          ? currentIds.filter((id) => id !== optionId)
          : [...currentIds, optionId];
        return { ...prev, [q.id]: next };
      }
      return { ...prev, [q.id]: currentIds.includes(optionId) ? [] : [optionId] };
    });
  };

  const buildAnswers = (): UiQuestionAnswer[] =>
    item.questions.map((q) => {
      const ids = selected[q.id] ?? [];
      const labels = q.options.filter((o) => ids.includes(o.id)).map((o) => o.label);
      const text = freeText[q.id]?.trim();
      return {
        questionId: q.id,
        selectedLabels: labels.length ? labels : undefined,
        freeText: text || undefined,
      };
    });

  const submit = () =>
    vscode.postMessage({ type: "question_answer", requestId: item.requestId, answers: buildAnswers() });

  return {
    step,
    setStep,
    selected,
    freeText,
    setFreeText,
    total,
    current,
    isLast,
    toggleOption,
    submit,
  };
}

function ActiveQuestionForm({
  question,
  selectedIds,
  freeTextValue,
  onToggle,
  onFreeTextChange,
  onEnter,
}: {
  question: UiQuestion;
  selectedIds: string[];
  freeTextValue: string;
  onToggle: (optionId: string) => void;
  onFreeTextChange: (value: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="question-block question-block-active">
      <div className="question-prompt">{question.prompt}</div>
      {question.allowMultiple && <div className="muted question-hint">Select all that apply</div>}
      <QuestionOptionList question={question} selectedIds={selectedIds} onToggle={onToggle} />
      <input
        className="question-free-text"
        type="text"
        placeholder={t("Other…")}
        value={freeTextValue}
        onChange={(e) => onFreeTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter();
        }}
      />
    </div>
  );
}

function ActiveQuestionCard({
  item,
  vscode,
}: {
  item: QuestionLogItem;
  vscode: VsCodeApi;
}) {
  const {
    step,
    setStep,
    selected,
    freeText,
    setFreeText,
    total,
    current,
    isLast,
    toggleOption,
    submit,
  } = useActiveQuestionFlow(item, vscode);

  if (!current) return null;

  const goNext = () => setStep((s) => s + 1);

  return (
    <div className="question-card panel-enter msg-enter">
      <div className="question-card-header">
        <span className="question-step-label">
          Question {step + 1} / {total}
        </span>
        <QuestionProgressDots questions={item.questions} step={step} />
      </div>

      <ActiveQuestionForm
        question={current}
        selectedIds={selected[current.id] ?? []}
        freeTextValue={freeText[current.id] ?? ""}
        onToggle={(optionId) => toggleOption(current, optionId)}
        onFreeTextChange={(value) => setFreeText((prev) => ({ ...prev, [current.id]: value }))}
        onEnter={() => (isLast ? submit() : goNext())}
      />

      <QuestionNavigation
        step={step}
        isLast={isLast}
        onBack={() => setStep((s) => Math.max(0, s - 1))}
        onNext={goNext}
        onSubmit={submit}
      />
    </div>
  );
}

export function QuestionCard({ item, vscode }: { item: QuestionLogItem; vscode: VsCodeApi }) {
  if (item.resolved) return <ResolvedQuestionCard item={item} />;
  return <ActiveQuestionCard item={item} vscode={vscode} />;
}
