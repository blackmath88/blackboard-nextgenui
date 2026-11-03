'use strict';

// Completed replies name their originating message and whether extraction was
// planned. That durable fact survives a crash before the background queue runs.
// Legacy/partial replies are deliberately not replayed. Successful extraction
// (including zero proposals) is terminal; its event commits with its records.
function extractionJobs(lines, events, active = new Map(), chat) {
  const byId = new Map(lines.map(line => [line.id, line]));
  const last = new Map(), settled = new Set();
  for (const event of events) {
    if (['extract', 'extract_dismissed'].includes(event.event)) settled.add(event.fromMessage);
    if (['extract', 'extract_error', 'extract_started', 'extract_dismissed'].includes(event.event) && event.fromMessage) last.set(event.fromMessage, event);
  }
  return lines.flatMap(reply => {
    if (reply.role !== 'assistant' || reply.extractionPlanned !== true || (chat && (reply.chat || 'c-1') !== chat)) return [];
    const event = last.get(reply.id);
    if (settled.has(reply.id)) return [];
    const user = byId.get(reply.replyTo);
    const valid = user?.role === 'user' && (user.chat || 'c-1') === (reply.chat || 'c-1');
    return [{ id: reply.id, userId: reply.replyTo, chat: reply.chat || 'c-1', at: reply.ts,
      title: valid ? String(user.text).slice(0, 120) : 'Original message unavailable',
      status: active.get(reply.id) || (event?.event === 'extract_error' ? 'failed' : 'interrupted'),
      error: !valid ? 'The original user message is missing or belongs to another chat.' : event?.error || null,
      retryable: !!valid && !active.has(reply.id) }];
  }).reverse();
}
module.exports = { extractionJobs };
