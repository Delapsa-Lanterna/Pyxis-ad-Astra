import type { JointEditSnapshot } from '@/shared/types';
const ORIGINAL_COLORS: Record<string, string> = {
  Common: '#bec8c8',
  'Low Tech': '#d16e5b',
  Midline: '#ddc968',
  'High Tech': '#a0d5e1',
  Remnant: '#46ffeb',
  Explorarium: '#9b8b86',
  Pirate: '#c80000',
  'Tri-Tachyon': '#87ceff',
  Hegemony: '#f5961e',
  'XIV Battlegroup': '#fcad3c',
  'Luddic Path': '#96c800',
  'Luddic Church': '#4ca914',
  'Persean League': '#dcb914',
  "Lion's Guard": '#a0005f',
  Unknown: '#9b9b9b',
  'Domain Restricted': '#9b9b9b',
  'Fabrique Orbitale': '#6464c8',
  'Exodyne Biotech': '#c9db04',
  'Ko Combine': '#ddc968',
  'Eridani-Utopia Terraforming': '#cce5ff',
  'Mbaye-Gogol': '#e9e979',
  'Bhilai Astra': '#c85043',
  Threat: '#829b91',
  'Shrouded Dweller': '#960a1e',
};
export function designTypeColor(snapshot: Pick<JointEditSnapshot, 'referenceSettings'>, name: string): string {
  const colors = snapshot.referenceSettings.values.designTypeColors;
  const value = colors && typeof colors === 'object' && !Array.isArray(colors) ? colors[name] : undefined;
  return Array.isArray(value) ? `rgba(${value.slice(0, 3).join(',')},${Number(value[3]) / 255})` : (ORIGINAL_COLORS[name] ?? '#bec8c8');
}
