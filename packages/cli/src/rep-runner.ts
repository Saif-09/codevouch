import { api } from './client.js';
import { confidence, textInput, choose, paint, rule, deltaBars, glyph, wrap, field } from './ui.js';
import { withSpinner } from './spinner.js';

/** Where you are in a digest. Five items should feel like five items. */
export interface RepPosition {
  index: number;
  total: number;
}

const counter = (at?: RepPosition) => (at ? `${at.index}/${at.total}` : undefined);

/** Grading is a model call, so it is never instant. Say what is happening. */
function grade<T>(work: () => Promise<T>): Promise<T> {
  return withSpinner('grading your answer', work, {
    transient: true,
    patience: [{ afterMs: 6_000, text: 'grading your answer (one model call)' }],
  });
}

/**
 * Runs one dossier rep interactively: confidence first (hard rule 2), then
 * the probe, then the reveal with the delta. The client only ever sees what
 * the /reps/ask route serialized; everything else arrives after the answer.
 */
export async function runRep(nodeId: string, at?: RepPosition): Promise<boolean> {
  let q: any;
  try {
    q = await api('POST', '/reps/ask', { nodeId });
  } catch {
    return false;
  }
  if (q.type === 'defend') return runDefend(q, at);

  console.log();
  rule(q.label, counter(at));
  if (q.callSites.length > 0) {
    console.log(paint.dim('  where it lives in your code'));
    for (const s of q.callSites) console.log(`  ${paint.dim(`${s.path}:${s.line}`)}  ${paint.dim(s.snippet)}`);
  } else {
    console.log(paint.dim(`  ${glyph.dot} no call sites found in the repo (that is itself worth knowing)`));
  }
  console.log();

  const before = await confidence(`How well do you understand what ${q.label} does here?`);
  const answer = await textInput(q.question);
  if (!answer.trim()) {
    console.log(paint.dim('skipped: nothing revealed, nothing scored.'));
    return false;
  }

  const reveal = await grade(() =>
    api('POST', `/reps/${q.repId}/answer`, { confidenceBefore: before, answer }));

  console.log();
  if (reveal.verdict === 'pass') console.log(paint.good(`${glyph.tick} pass. state: ${reveal.stateNow}`));
  else if (reveal.saidUnsure) console.log(paint.warn(`${glyph.dot} you said you did not know. here it is.`));
  else if (reveal.verdict === 'partial') console.log(paint.warn(`${glyph.dot} partial. ${wrap(reveal.gap ?? '', 2, 11)}`));
  else if (reveal.verdict === 'fail') console.log(paint.bad(`${glyph.cross} not yet. ${wrap(reveal.gap ?? '', 2, 11)}`));
  else console.log(paint.dim(`${glyph.dot} ungraded (grader unavailable or unsure): read the reveal, nothing promoted.`));

  // Anything short of a pass gets the answer itself, not just the shortfall.
  // A rep you got wrong and were never told the answer to teaches nothing.
  if (reveal.verdict !== 'pass' && reveal.expectedAnswer) {
    console.log(`\n${field('the answer', reveal.expectedAnswer)}`);
  }

  if (reveal.body) {
    console.log();
    console.log(field('what it does here', reveal.body.what_it_does_here));
    console.log(field('if it vanished', reveal.body.if_it_vanished));
    if (reveal.body.replaced) console.log(field('replaced', reveal.body.replaced));
  }
  if (reveal.impact && Object.keys(reveal.impact).length > 0) {
    const im = reveal.impact;
    const bits: string[] = [];
    if (im.installSizeBytes) bits.push(`install size ${(im.installSizeBytes / 1024).toFixed(0)} kB`);
    if (im.transitiveCount != null) bits.push(`${im.transitiveCount} transitive deps`);
    if (im.weeklyDownloads != null) bits.push(`${im.weeklyDownloads.toLocaleString('en-US')} downloads/wk`);
    if (im.license) bits.push(im.license);
    if (im.advisories?.length) bits.push(paint.bad(`${im.advisories.length} advisories`));
    if (im.deprecated) bits.push(paint.bad('DEPRECATED'));
    if (bits.length) console.log(paint.dim(`\n${bits.join(` ${glyph.dot} `)}`));
    if (im.service) {
      console.log(paint.warn(`\nservice: ${im.service.service}`));
      console.log(paint.dim(`  at 10k users: ${im.service.pricingAt10k}`));
      console.log(paint.dim(`  when it is down: ${im.service.failureMode}`));
      console.log(paint.dim(`  data that leaves: ${im.service.dataEgress}`));
    }
  }

  printDelta(reveal);

  const after = await confidence('And now, having seen it, how well do you understand it?');
  await api('POST', `/reps/${q.repId}/after`, { confidenceAfter: after });
  return true;
}

/**
 * The delta, drawn as two bars. This is the product: the number you claimed
 * against the number you showed, in the same picture.
 */
function printDelta(reveal: any): void {
  if (reveal.verdict === 'ungraded') return;
  const delta = reveal.confidenceBefore - reveal.demonstrated;
  console.log();
  if (delta > 0) console.log(paint.bad(`the gap: ${delta} rung${delta === 1 ? '' : 's'} of confidence you had not earned`));
  else if (delta < 0) console.log(paint.good('better than you thought'));
  else console.log(paint.good('calibrated.'));
  console.log(deltaBars(reveal.confidenceBefore, reveal.demonstrated));
}

/**
 * The Defend rep (tech spec §7.2): reconstruct the change from memory, then
 * one recognition item, then the withheld brief. The files are the only
 * prompt on purpose; showing the diff would make it reading, not recall.
 */
async function runDefend(q: any, at?: RepPosition): Promise<boolean> {
  console.log();
  rule(`${q.label}  (something you shipped)`, counter(at));
  console.log(paint.dim('  it touched'));
  for (const p of (q.paths ?? []).slice(0, 8)) console.log(paint.dim(`  ${p}`));
  console.log();

  const before = await confidence('How well could you explain this change to someone right now?');
  const reconstruction = await textInput(q.question);
  if (!reconstruction.trim()) {
    console.log(paint.dim('skipped: nothing revealed, nothing scored.'));
    return false;
  }

  console.log(`\n${paint.em('Which of these describes how the data actually moves?')}`);
  const flowChoice = await choose(q.flowOptions ?? []);

  const reveal = await grade(() =>
    api('POST', `/reps/${q.repId}/defend`, {
      confidenceBefore: before,
      reconstruction,
      flowChoice,
    }));

  console.log();
  if (reveal.verdict === 'pass') console.log(paint.good(`${glyph.tick} pass. state: ${reveal.stateNow}`));
  else if (reveal.saidUnsure) console.log(paint.warn(`${glyph.dot} you said you did not remember. here is what it does.`));
  else if (reveal.verdict === 'partial') console.log(paint.warn(`${glyph.dot} partial. ${wrap(reveal.gap ?? '', 2, 11)}`));
  else if (reveal.verdict === 'fail') console.log(paint.bad(`${glyph.cross} not yet. ${wrap(reveal.gap ?? '', 2, 11)}`));
  else console.log(paint.dim(`${glyph.dot} ungraded (grader unavailable or unsure): read the brief, nothing promoted.`));

  console.log(reveal.flowWasRight ? paint.good(`${glyph.tick} data flow: right`) : paint.bad(`${glyph.cross} data flow: wrong`));
  if (!reveal.flowWasRight) console.log(paint.dim(`  actually: ${wrap(reveal.flowCorrect, 4, 12)}`));

  const b = reveal.brief;
  console.log(`\n${paint.em('what it actually does')}`);
  for (const line of b.approach) console.log(`  ${paint.dim(glyph.dot)} ${wrap(line, 4, 4)}`);
  if (b.assumptions?.length) {
    console.log(`\n${paint.em('what it assumes')} ${paint.dim('(wrong here means the feature is wrong, not just buggy)')}`);
    for (const a of b.assumptions) console.log(`  ${paint.dim(glyph.dot)} ${wrap(a, 4, 4)}`);
  }
  if (b.breaks_first?.length) {
    console.log(`\n${paint.em('where it breaks first')}`);
    for (const x of b.breaks_first) console.log(`  ${paint.dim(glyph.dot)} ${wrap(x, 4, 4)}`);
  }
  if (b.rejected?.length) {
    console.log(`\n${paint.em('roads not taken')}`);
    for (const r of b.rejected) console.log(`  ${r.option}: ${paint.dim(wrap(r.why_not, 4, r.option.length + 4))}`);
  }
  if (reveal.filesPromoted > 0) {
    console.log(paint.dim(`\n${reveal.filesPromoted} file${reveal.filesPromoted === 1 ? '' : 's'} in this feature moved with it.`));
  }

  printDelta(reveal);

  const after = await confidence('And now, having seen the brief, how well could you explain it?');
  await api('POST', `/reps/${q.repId}/after`, { confidenceAfter: after });
  return true;
}

/**
 * A card (spec §7.4): confidence, one recognition item, done. No model call,
 * so re-testing what you already learned is free forever.
 */
export async function runCard(card: any, at?: RepPosition): Promise<boolean> {
  console.log();
  rule(`${card.label}  (${card.kind}, re-test)`, counter(at));
  console.log();
  const before = await confidence('How well do you still remember this?');
  console.log(`\n${paint.em(card.question)}`);
  const choice = await choose(card.options);

  const reveal = await api('POST', `/reps/${card.repId}/card`, { confidenceBefore: before, choice });
  console.log();
  if (reveal.correct) {
    console.log(paint.good(`${glyph.tick} right. still yours. state: ${reveal.stateNow}`));
  } else {
    console.log(paint.bad(`${glyph.cross} not right.`));
    console.log(field('actually', reveal.correctAnswer));
    console.log(paint.dim(`state: ${reveal.stateNow}`));
  }
  printDelta({ ...reveal, verdict: 'graded' });
  return true;
}
