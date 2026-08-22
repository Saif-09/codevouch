import { api } from './client.js';
import { confidence, textInput, choose, paint, hr } from './ui.js';

/**
 * Runs one dossier rep interactively: confidence first (hard rule 2), then
 * the probe, then the reveal with the delta. The client only ever sees what
 * the /reps/ask route serialized; everything else arrives after the answer.
 */
export async function runRep(nodeId: string): Promise<boolean> {
  let q: any;
  try {
    q = await api('POST', '/reps/ask', { nodeId });
  } catch {
    return false;
  }
  if (q.type === 'defend') return runDefend(q);

  hr();
  console.log(paint.title(q.label));
  if (q.callSites.length > 0) {
    console.log(paint.dim('where it lives in your code:'));
    for (const s of q.callSites) console.log(paint.dim(`  ${s.path}:${s.line}  ${s.snippet}`));
  } else {
    console.log(paint.dim('  no call sites found in the repo (that is itself worth knowing)'));
  }
  console.log();

  const before = await confidence(`How well do you understand what ${q.label} does here?`);
  const answer = await textInput(q.question);
  if (!answer.trim()) {
    console.log(paint.dim('skipped: nothing revealed, nothing scored.'));
    return false;
  }

  const reveal = await api('POST', `/reps/${q.repId}/answer`, { confidenceBefore: before, answer });

  console.log();
  if (reveal.verdict === 'pass') console.log(paint.good(`pass. state: ${reveal.stateNow}`));
  else if (reveal.verdict === 'partial') console.log(paint.warn(`partial. ${reveal.gap ?? ''}`));
  else if (reveal.verdict === 'fail') console.log(paint.bad(`not yet. ${reveal.gap ?? ''}`));
  else console.log(paint.dim('ungraded (grader unavailable or unsure): read the reveal, nothing promoted.'));

  if (reveal.body) {
    console.log();
    console.log(`${paint.em('what it does here')}: ${reveal.body.what_it_does_here}`);
    console.log(`${paint.em('if it vanished')}: ${reveal.body.if_it_vanished}`);
    if (reveal.body.replaced) console.log(`${paint.em('replaced')}: ${reveal.body.replaced}`);
  }
  if (reveal.impact && Object.keys(reveal.impact).length > 0) {
    const im = reveal.impact;
    const bits: string[] = [];
    if (im.installSizeBytes) bits.push(`install size ${(im.installSizeBytes / 1024).toFixed(0)} kB`);
    if (im.transitiveCount != null) bits.push(`${im.transitiveCount} transitive deps`);
    if (im.weeklyDownloads != null) bits.push(`${im.weeklyDownloads.toLocaleString()} downloads/wk`);
    if (im.license) bits.push(im.license);
    if (im.advisories?.length) bits.push(paint.bad(`${im.advisories.length} advisories`));
    if (im.deprecated) bits.push(paint.bad('DEPRECATED'));
    if (bits.length) console.log(paint.dim(bits.join(' · ')));
    if (im.service) {
      console.log(paint.warn(`service: ${im.service.service}`));
      console.log(paint.dim(`  at 10k users: ${im.service.pricingAt10k}`));
      console.log(paint.dim(`  when it is down: ${im.service.failureMode}`));
      console.log(paint.dim(`  data that leaves: ${im.service.dataEgress}`));
    }
  }

  const delta = reveal.confidenceBefore - reveal.demonstrated;
  if (reveal.verdict !== 'ungraded') {
    if (delta > 0) console.log(`\n${paint.bad(`the gap: you rated ${reveal.confidenceBefore}/7, you demonstrated ${reveal.demonstrated}/7`)}`);
    else if (delta < 0) console.log(`\n${paint.good(`better than you thought: rated ${reveal.confidenceBefore}/7, demonstrated ${reveal.demonstrated}/7`)}`);
    else console.log(`\n${paint.good('calibrated.')}`);
  }

  const after = await confidence('And now, having seen it, how well do you understand it?');
  await api('POST', `/reps/${q.repId}/after`, { confidenceAfter: after });
  return true;
}

/**
 * The Defend rep (tech spec §7.2): reconstruct the change from memory, then
 * one recognition item, then the withheld brief. The files are the only
 * prompt on purpose; showing the diff would make it reading, not recall.
 */
async function runDefend(q: any): Promise<boolean> {
  hr();
  console.log(`${paint.title(q.label)}  ${paint.dim('(something you shipped)')}`);
  console.log(paint.dim('it touched:'));
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

  const reveal = await api('POST', `/reps/${q.repId}/defend`, {
    confidenceBefore: before,
    reconstruction,
    flowChoice,
  });

  console.log();
  if (reveal.verdict === 'pass') console.log(paint.good(`pass. state: ${reveal.stateNow}`));
  else if (reveal.verdict === 'partial') console.log(paint.warn(`partial. ${reveal.gap ?? ''}`));
  else if (reveal.verdict === 'fail') console.log(paint.bad(`not yet. ${reveal.gap ?? ''}`));
  else console.log(paint.dim('ungraded (grader unavailable or unsure): read the brief, nothing promoted.'));

  console.log(reveal.flowWasRight ? paint.good('data flow: right') : paint.bad('data flow: wrong'));
  if (!reveal.flowWasRight) console.log(paint.dim(`  actually: ${reveal.flowCorrect}`));

  const b = reveal.brief;
  console.log(`\n${paint.em('what it actually does')}`);
  for (const line of b.approach) console.log(`  ${line}`);
  if (b.assumptions?.length) {
    console.log(`\n${paint.em('what it assumes')} ${paint.dim('(wrong here means the feature is wrong, not just buggy)')}`);
    for (const a of b.assumptions) console.log(`  ${a}`);
  }
  if (b.breaks_first?.length) {
    console.log(`\n${paint.em('where it breaks first')}`);
    for (const x of b.breaks_first) console.log(`  ${x}`);
  }
  if (b.rejected?.length) {
    console.log(`\n${paint.em('roads not taken')}`);
    for (const r of b.rejected) console.log(`  ${r.option}: ${paint.dim(r.why_not)}`);
  }

  if (reveal.verdict !== 'ungraded') {
    const delta = reveal.confidenceBefore - reveal.demonstrated;
    if (delta > 0) console.log(`\n${paint.bad(`the gap: you rated ${reveal.confidenceBefore}/7, you demonstrated ${reveal.demonstrated}/7`)}`);
    else if (delta < 0) console.log(`\n${paint.good(`better than you thought: rated ${reveal.confidenceBefore}/7, demonstrated ${reveal.demonstrated}/7`)}`);
    else console.log(`\n${paint.good('calibrated.')}`);
  }

  const after = await confidence('And now, having seen the brief, how well could you explain it?');
  await api('POST', `/reps/${q.repId}/after`, { confidenceAfter: after });
  return true;
}

/**
 * A card (spec §7.4): confidence, one recognition item, done. No model call,
 * so re-testing what you already learned is free forever.
 */
export async function runCard(card: any): Promise<boolean> {
  hr();
  console.log(`${paint.title(card.label)}  ${paint.dim(`(${card.kind}, re-test)`)}`);
  console.log();
  const before = await confidence('How well do you still remember this?');
  console.log(`\n${paint.em(card.question)}`);
  const choice = await choose(card.options);

  const reveal = await api('POST', `/reps/${card.repId}/card`, { confidenceBefore: before, choice });
  console.log();
  if (reveal.correct) {
    console.log(paint.good(`right. still yours. state: ${reveal.stateNow}`));
  } else {
    console.log(paint.bad('not right.'));
    console.log(`${paint.em('actually')}: ${reveal.correctAnswer}`);
    console.log(paint.dim(`state: ${reveal.stateNow}`));
  }
  const delta = reveal.confidenceBefore - reveal.demonstrated;
  if (delta > 0) console.log(paint.bad(`the gap: rated ${reveal.confidenceBefore}/7, demonstrated ${reveal.demonstrated}/7`));
  else if (delta < 0) console.log(paint.good(`better than you thought: rated ${reveal.confidenceBefore}/7`));
  return true;
}
