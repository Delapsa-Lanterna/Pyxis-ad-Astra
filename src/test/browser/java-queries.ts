import type { JavaDocumentEdit, JavaInspection, JavaQueryPurpose } from '@/shared/types';
import type { JavaAssistance, JavaAssistPurpose } from '@/shared/types';

/** Browser fixtures supply explicit projections; native tests own JDT correctness. */
export function createJavaQueryPreview() {
  const projects = new Map<string, { revision: number; files: Map<string, { source: string; version: number }> }>();
  const facts = new Map<string, JavaInspection>();
  const assists = new Map<string, JavaAssistance>();
  return {
    facts,
    assists,
    source: (label: string, file: string) => projects.get(label)?.files.get(file)?.source,
    release: (label: string) => projects.delete(label),
    invoke(
      label: string,
      action: {
        kind: string;
        documents?: JavaDocumentEdit[];
        file?: string;
        offset?: number;
        purpose?: JavaQueryPurpose | JavaAssistPurpose;
        revision?: number;
      },
    ) {
      if (action.kind === 'close') {
        projects.delete(label);
        return;
      }
      if (action.kind === 'start') {
        projects.set(label, { revision: 1, files: new Map() });
        return;
      }
      const project = projects.get(label)!;
      if (action.kind === 'assist') {
        if (action.purpose === 'validate' && action.revision !== project.revision) throw Error('Project revision is stale');
        return {
          result: {
            assistance: true,
            purpose: action.purpose,
            project: label,
            file: action.file,
            version: project.files.get(action.file!)?.version ?? 1,
            argument: 0,
            candidates: [],
            files: [],
            choices: [],
            conflicts: [],
            ...assists.get(action.file! + ':' + action.purpose),
            revision: project.revision,
          },
        };
      }
      if (action.kind === 'sync') {
        for (const document of action.documents!) {
          const previous = project.files.get(document.previousFile ?? document.file);
          let source = document.source;
          if (source === null) {
            const parts = [];
            let offset = 0;
            for (const edit of document.edits) {
              parts.push(previous!.source.slice(offset, edit.from), edit.text);
              offset = edit.to;
            }
            source = parts.join('') + previous!.source.slice(offset);
          }
          if (document.previousFile) project.files.delete(document.previousFile);
          project.files.set(document.file, { source, version: document.version });
        }
        project.revision++;
        return;
      }
      const file = action.file!,
        document = project.files.get(file),
        fixture = facts.get(file);
      const result: JavaInspection = {
        purpose: action.purpose as JavaQueryPurpose,
        project: label,
        revision: project.revision,
        file,
        version: document?.version ?? 1,
        source: null,
        origin: null,
        binding: null,
        diagnostics: [],
        outline: [],
        locations: [],
        ...fixture,
      };
      result.purpose = action.purpose as JavaQueryPurpose;
      result.source = null;
      result.revision = project.revision;
      result.version = document?.version ?? 1;
      if (action.purpose === 'source') result.source = fixture?.source ?? document!.source;
      if (action.purpose === 'hover') result.locations = [];
      return { result };
    },
  };
}
