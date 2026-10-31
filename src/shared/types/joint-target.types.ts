export type JointEditKind = 'ship' | 'skin' | 'weapon' | 'wing' | 'variant';
export interface JointEditRoot {
  sessionId: string;
  modRoot: string;
  kind: JointEditKind;
  id: string;
}
