import type { ResourceRef, ResourceSource } from '@/shared/types/project-identity.types';
import type { ReferenceSource } from './project-identity.types';

export interface SourceOptionGroup {
  reference?: ReferenceSource;
  origin: ResourceSource;
  options: SourceOption[];
}

export interface SourceOption {
  label: string;
  value: string;
  description: string | null;
  resourceRef: ResourceRef | null;
  origin: ResourceSource;
  templateValue?: string;
  templateMax?: number;
}

export interface CsvSourceOptionsPayload {
  sessionId: string;
  source: string;
}

export interface ImageSourceOptionsPayload {
  sessionId: string;
  directories: string[];
  missionId: string | null;
}
