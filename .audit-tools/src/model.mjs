export const OVERVIEW_SCHEMA_VERSION = 2;

/**
 * @typedef {{path: string, line: number | null, column?: number | null, text: string, parser: string, conditional?: string}} Evidence
 * @typedef {{module: string, relation: string, evidence: Evidence[]}} Candidate
 * @typedef {{status: 'shared' | 'declared' | 'candidate' | 'conflict' | 'unmatched', candidates: Candidate[], owner: string | null, sharedEvidence?: Evidence[]}} Ownership
 * @typedef {{path: string, hash: string, bytes: number, lines: number | null, role: string, roleEvidence?: Evidence[], text: string | null, ownership: Ownership}} File
 * @typedef {'owns' | 'consumes' | 'assembles' | 'related'} ReferenceKind
 * @typedef {{id: string, title: string, path: string, references: {path: string, role: string, line: number, kind: ReferenceKind}[]}} Module
 * @typedef {{kind: string, source: string, target: string, line: number | null, column?: number, targetColumn?: number, conditional?: string, testOnly?: boolean, targetLine?: number | null, symbols: string, parser: string, dependencyClass?: 'usage' | 'structure' | 'unresolved', sourceSymbol?: string, targetSymbol?: string, positionKind?: 'reference' | 'declaration', evidence?: Evidence[]}} Edge
 * @typedef {{kind: string, path: string, line: number | null, column?: number, conditional?: string, testOnly?: boolean, message: string, parser: string, candidates?: Evidence[]}} Issue
 * @typedef {{path: string, line: number, column: number, name: string, scope: string, kind: string, text: string, conditional?: string, testOnly?: boolean, qualified?: string | null}} Declaration
 * @typedef {{path: string, line: number, role: string, value: string | null, expression: string, parser: string, conditional?: string, testOnly?: boolean}} Event
 * @typedef {{files: File[], digest: string, head: string, root: string}} AuditInputSnapshot
 * @typedef {{id: string, label: string, kind: string, locations: {path: string, line: number}[]}} RustSymbol
 * @typedef {{source: string, target: string, kind: string}} RustRelation
 * @typedef {{symbols: RustSymbol[], relations: RustRelation[], declarations: Declaration[], edges: Edge[], events: Event[], commands: Map<string, Declaration[]>, moduleParents: {parentPath: string, childPath: string, line: number, testOnly: boolean}[], referenceResolutions: {space: 'type' | 'value', kind: string, path: string, line: number, column: number, scope: string, conditional: string, testOnly: boolean, name: string, generated?: string, receiver?: string, receiverEvidence?: Evidence[], route: 'semantic', reason: string, targets: Evidence[]}[], issues: Issue[]}} RustFacts
 * @typedef {{nodes: {id: string, label: string, files: string[]}[], edges: {source: string, target: string, evidence: string[]}[]}} Exploration
 * @typedef {{schemaVersion: number, run: Record<string, unknown>, modules: Module[], files: File[], edges: Edge[], declarations: Declaration[], events: Event[], issues: Issue[], cycles: {kind: string, basis: string, scope: string, relationScope: string, category: string, members: string[], chain: string[]}[], rust: {symbols: RustSymbol[], relations: RustRelation[]}, exploration: Exploration | null}} Report
 * @typedef {{id: string, label: string, title?: string}} GraphNode
 * @typedef {{source: string, target: string, count: number, kinds?: Record<string, number>}} GraphEdge
 * @typedef {{nodes: GraphNode[], edges: GraphEdge[]}} DependencyGraph
 * @typedef {{id: string, path: string, role: string, bytes: number, lines: number | null, hash: string, ownership: {status: string, owner: string | null, candidates: {module: string, relation: string}[]}}} FileSummary
 * @typedef {{kind: string, count: number, samples: {path: string, line: number | null, message: string}[]}} IssueCategory
 * @typedef {{schemaVersion: typeof OVERVIEW_SCHEMA_VERSION, reportId: string, run: {id: string, head: string, digest: string, startedAt: string, completedAt: string, toolVersion: string, engines: Record<string, unknown>}, metrics: {modules: number, files: number, relationships: number, issues: number, ownership: Record<string, number>, roles: Record<string, number>, coverage: {productionFiles: number, declared: number, shared: number, missing: string[], affectedReferences: number}}, edgeKinds: string[], modules: (Module & {fileCount: number})[], files: FileSummary[], graph: DependencyGraph, issueCategories: IssueCategory[], cycles: Report['cycles'], exploration: DependencyGraph | null}} ReportOverview
 * @typedef {{module: Module & {fileCount: number}, files: FileSummary[], edges: {source: string, target: string, references: Edge[]}[]}} ModuleDetail
 * @typedef {{file: File, declarations: Declaration[], events: Event[], edges: Edge[]}} FileDetail
 * @typedef {{files: File[], edges: Edge[]}} GraphIndex
 */
