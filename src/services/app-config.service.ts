import { invokeCommand } from '@/shared/runtime/command.runtime';

export function openConfigFolder(): Promise<void> {
  return invokeCommand('open_config_dir');
}
