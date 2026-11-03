'use strict';

const chatOf = line => line.chat || 'c-1';
function messageIndex(lines) {
  const index = new Map();
  for (const line of lines) {
    if (typeof line.id !== 'string' || !line.id) continue;
    const matches = index.get(line.id) || []; matches.push(line); index.set(line.id, matches);
  }
  return index;
}
function turnFromIndex(index, id) {
  const replies = index.get(id) || [];
  if (replies.length > 1) return { error: 'The reply identity is ambiguous; preserve the transcript and repair duplicate message IDs.' };
  const reply = replies[0];
  if (reply?.role !== 'assistant' || reply.extractionPlanned !== true) return { error: 'The original complete reply is unavailable.' };
  const users = index.get(reply.replyTo) || [];
  if (users.length > 1) return { reply, error: 'The original user message identity is ambiguous; preserve the transcript and repair duplicate message IDs.' };
  const user = users[0];
  if (user?.role !== 'user' || chatOf(user) !== chatOf(reply)) return { reply, error: 'The original user message is missing or belongs to another chat.' };
  return { reply, user };
}
const extractionTurn = (lines, id) => turnFromIndex(messageIndex(lines), id);

// Completed replies name their originating message and whether extraction was
// planned. That durable fact survives a crash before the background queue runs.
// Legacy/partial replies are deliberately not replayed. Successful extraction
// (including zero proposals) is terminal; its event commits with its records.
function extractionJobs(lines, events, active = new Map(), chat) {
  const byId = messageIndex(lines);
  const last = new Map(), settled = new Set(), shown = new Set();
  for (const event of events) {
    if (['extract', 'extract_dismissed'].includes(event.event)) settled.add(event.fromMessage);
    if (['extract', 'extract_error', 'extract_started', 'extract_dismissed'].includes(event.event) && event.fromMessage) last.set(event.fromMessage, event);
  }
  return lines.flatMap(reply => {
    if (reply.role !== 'assistant' || reply.extractionPlanned !== true || (chat && (reply.chat || 'c-1') !== chat)) return [];
    if (shown.has(reply.id)) return [];
    shown.add(reply.id);
    const event = last.get(reply.id);
    if (settled.has(reply.id)) return [];
    const turn = turnFromIndex(byId, reply.id), valid = !turn.error;
    return [{ id: reply.id, userId: reply.replyTo, chat: reply.chat || 'c-1', at: reply.ts,
      title: valid ? String(turn.user.text).slice(0, 120) : 'Original message unavailable',
      status: active.get(reply.id) || (event?.event === 'extract_error' ? 'failed' : 'interrupted'),
      error: turn.error || event?.error || null,
      retryable: valid && !active.has(reply.id), dismissible: !!turn.reply && !active.has(reply.id) }];
  }).reverse();
}
module.exports = { extractionJobs, extractionTurn };
