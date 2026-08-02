import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AskUserAnswer, AskUserHandler, UserActionHandler } from "@ninjacode/tools";
import { t } from "./i18n.js";

async function answerQuestionWithOptions(
  rl: ReturnType<typeof createInterface>,
  q: { id: string; prompt: string; options: Array<{ label: string }>; allowMultiple?: boolean },
): Promise<AskUserAnswer> {
  console.log(`\n❓ ${q.prompt}`);
  q.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
  const ans = await rl.question(q.allowMultiple ? t("cli.choiceMulti") : t("cli.choiceSingle"));
  const indices = ans
    .split(",")
    .map((s) => Number(s.trim()) - 1)
    .filter((i) => Number.isInteger(i) && i >= 0 && i < q.options.length);
  if (indices.length) {
    return { questionId: q.id, selectedLabels: indices.map((i) => q.options[i]!.label) };
  }
  return { questionId: q.id, freeText: ans };
}

export function setupAskUserHandlers(
  setAskUserHandler: (handler: AskUserHandler) => void,
  setUserActionHandler: (handler: UserActionHandler) => void,
): void {
  setAskUserHandler(async (request) => {
    const rl = createInterface({ input, output });
    const answers: AskUserAnswer[] = [];
    try {
      for (const q of request.questions) {
        if (q.options.length) {
          answers.push(await answerQuestionWithOptions(rl, q));
        } else {
          const ans = await rl.question(`\n❓ ${q.prompt}\n> `);
          answers.push({ questionId: q.id, freeText: ans });
        }
      }
      return answers;
    } finally {
      rl.close();
    }
  });

  setUserActionHandler(async (request) => {
    const rl = createInterface({ input, output });
    try {
      console.log(t("cli.manualAction", { action: request.action }));
      if (request.reason) console.log(t("cli.reason", { reason: request.reason }));
      const comment = await rl.question(t("cli.pressEnter"));
      return { comment: comment.trim() || undefined };
    } finally {
      rl.close();
    }
  });
}
