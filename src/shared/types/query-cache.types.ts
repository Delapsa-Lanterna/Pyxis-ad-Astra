export interface SessionQueryIdentity<TParameters extends object = object> {
  sessionId: string;
  queryKind: string;
  parameters: TParameters;
}
