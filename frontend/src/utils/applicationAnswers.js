// An application's answers are stored one per question, each with the wording it was asked with.
// This lists every question currently on the form (unanswered read "(no answer)"), then any answer
// whose question was since removed, under its original wording.
export function applicationAnswerList(questions, answers) {
  const given = new Map((answers || []).filter((a) => a.questionId).map((a) => [a.questionId, a]));
  const text = (a) => (a?.values?.length ? a.values.join(", ") : a?.value) || "(no answer)";
  const current = new Set(questions.map((q) => q.id));
  return [
    ...questions.map((q) => ({ id: q.id, label: q.label, answer: text(given.get(q.id)) })),
    ...(answers || [])
      .filter((a) => !a.questionId || !current.has(a.questionId))
      .map((a, n) => ({ id: `removed-${n}`, label: a.label, answer: text(a), removed: true })),
  ];
}
