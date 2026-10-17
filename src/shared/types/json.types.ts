export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RowData = Record<string, JsonValue>;

export type JsonInputShape = 'object' | 'array' | 'json';
export type JsonInputValue<T extends JsonInputShape> = T extends 'object' ? RowData : T extends 'array' ? JsonValue[] : JsonValue;

export type ReadonlyJsonValue = null | boolean | number | string | ReadonlyJsonArray | ReadonlyJsonObject;
export type ReadonlyJsonArray = readonly ReadonlyJsonValue[];
export interface ReadonlyJsonObject {
  readonly [key: string]: ReadonlyJsonValue;
}
export type DeepReadonly<T> = [JsonValue] extends [T]
  ? ReadonlyJsonValue
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : T;
