import type { SpecEditorKind } from '@/shared/types/index';

export interface SpecEditorWindowSize {
  height: number;
  minHeight: number;
  minWidth: number;
  width: number;
}

export interface SpecEditorWindowDefinition {
  label: string;
  size: SpecEditorWindowSize;
}

const SPEC_EDITOR_WINDOW_DEFINITIONS: Record<SpecEditorKind, SpecEditorWindowDefinition> = {
  ship: {
    label: '舰船编辑器',
    size: { width: 1160, height: 760, minWidth: 860, minHeight: 560 },
  },
  weapon: {
    label: '武器编辑器',
    size: { width: 1160, height: 760, minWidth: 860, minHeight: 560 },
  },
  projectile: {
    label: '弹体编辑器',
    size: { width: 1160, height: 760, minWidth: 860, minHeight: 560 },
  },
  system: {
    label: '战术系统编辑器',
    size: { width: 900, height: 760, minWidth: 720, minHeight: 520 },
  },
};

export function specEditorWindowDefinition(kind: SpecEditorKind): SpecEditorWindowDefinition {
  return SPEC_EDITOR_WINDOW_DEFINITIONS[kind];
}

export function specEditorWindowTitle(kind: SpecEditorKind, id: string): string {
  return `${specEditorWindowDefinition(kind).label} - ${id}`;
}

export function specEditorWindowLabel(kind: SpecEditorKind): string {
  return specEditorWindowDefinition(kind).label;
}
