export const JOINT_EDIT_KINDS = ['ship', 'skin', 'weapon', 'wing', 'variant'] as const;
export type JointEditKind = (typeof JOINT_EDIT_KINDS)[number];
export interface JointEditRoot {
  sessionId: string;
  modRoot: string;
  kind: JointEditKind;
  id: string;
}
