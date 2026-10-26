/** The client protocol owns identity: absent optional fields stay absent. */
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CORRELATION = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function optionalIdentity(payload, { navigation = false } = {}) {
  const fields = {
    projectId: { max: 128, pattern: SCOPE },
    appId: { max: 256, pattern: SCOPE },
    environment: { max: 64, pattern: SCOPE },
    sessionId: { max: 128, pattern: CORRELATION },
    navigationId: { max: 128, pattern: CORRELATION },
  };
  if (navigation) fields.contextId = { max: 256, pattern: CORRELATION };
  const identity = {};
  for (const [key, { max, pattern }] of Object.entries(fields)) {
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (typeof value !== 'string' || value.length > max || !pattern.test(value)) {
      return { error: `${key} must be a non-empty identity string (max ${max})` };
    }
    identity[key] = value;
  }
  if (navigation && identity.contextId != null && identity.contextId !== payload.uid) {
    return { error: 'contextId must match navigation uid' };
  }
  return { identity };
}
