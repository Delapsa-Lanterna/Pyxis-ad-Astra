import type { ResourceRef, ResourceSource } from '@/shared/types/project-identity.types';

export interface SourceOptionGroup {
  origin: ResourceSource;
  options: SourceOption[];
}

export interface SourceOption {
  label: string;
  value: string;
  description: string | null;
  resourceRef: ResourceRef | null;
  origin: ResourceSource;
}

export interface CsvSourceOptionsPayload {
  sessionId: string;
  source: string;
}
