// CLI Pilot: a small hand validator for the subset of JSON Schema the pilot's closed schemas use (type, required,
// additionalProperties: false, properties, enum, minLength, maxLength, maxItems, items). Chosen over Ajv: no
// dependency, and the schemas are closed and tiny. An unknown keyword fails loudly at startup (assertSupported), so a
// keyword the validator would silently ignore can never slip into a schema.
// pilot-v0.10: moved out of server.js unchanged, so frame.js (frame-intent.schema.json) uses the same validator.
'use strict';
const KNOWN = new Set(['$schema', 'title', 'description', 'type', 'required', 'additionalProperties', 'properties', 'enum', 'minLength', 'maxLength', 'maxItems', 'items']);
function assertSupported(s, name) {
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`${name} uses "${k}", which the hand validator does not support`);
  if (s.properties) Object.values(s.properties).forEach((p) => assertSupported(p, name));
  if (s.items) assertSupported(s.items, name);
}
function validate(s, v, at = '$') {
  const errs = [];
  const type = Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v;
  if (s.type && !(s.type === type || (s.type === 'number' && type === 'integer'))) return [`${at}: expected ${s.type}, got ${type}`];
  if (s.enum && !s.enum.includes(v)) errs.push(`${at}: must be one of ${s.enum.join(', ')}`);
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${at}: shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${at}: longer than ${s.maxLength}`);
  }
  if (type === 'object') {
    for (const r of s.required || []) if (!(r in v)) errs.push(`${at}: missing "${r}"`);
    for (const [k, val] of Object.entries(v)) {
      if (s.properties && s.properties[k]) errs.push(...validate(s.properties[k], val, `${at}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${at}: unexpected "${k}"`);
    }
  }
  if (type === 'array') {
    if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${at}: ${v.length} items, at most ${s.maxItems} allowed`);
    if (s.items) v.forEach((x, i) => errs.push(...validate(s.items, x, `${at}[${i}]`)));
  }
  return errs;
}
module.exports = { assertSupported, validate };
