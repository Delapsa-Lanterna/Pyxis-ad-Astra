const ENTITY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const ENTITY_ID_HINT = '仅允许以 ASCII 字母或数字开头，只能包含 ASCII 字母、数字、下划线（_）、点（.）、连字符（-）';

export function isEntityId(value: string): boolean {
  return ENTITY_ID_RE.test(value.trim());
}

export function entityIdInvalidMessage(label: string, value?: string): string {
  const subject = value ? `${label} "${value}"` : label;
  return `${subject} ${ENTITY_ID_HINT}`;
}
