import type * as Vis from 'vis-network';
declare global {
  interface Document {
    getElementById(
      elementId:
        | 'audit-data'
        | 'graph'
        | 'graphStatus'
        | 'detail'
        | 'entries'
        | 'listCount'
        | 'fileTable'
        | 'filesTitle'
        | 'pageStatus'
        | 'previous'
        | 'next'
        | 'issues'
        | 'overview'
        | 'fit'
        | 'qualityButton'
        | 'quality'
        | 'cycleButton'
        | 'cycleList'
        | 'cycles'
        | 'metrics'
        | 'identity',
    ): HTMLElement;
  }
  interface Window {
    vis: typeof Vis;
    dagre: typeof import('@dagrejs/dagre');
  }
}
export {};
