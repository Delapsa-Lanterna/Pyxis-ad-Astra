import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { JavaProjectAction, JavaProjectSnapshot, JavaDeploy, JavaDeployPreview, WriteResult } from '@/shared/types';

export function javaProject(action: JavaProjectAction) {
  return invokeCommand<JavaProjectSnapshot>('java_project', { action });
}
export function previewJavaDeployment(artifact: string, target: string) {
  return invokeCommand<JavaDeployPreview>('preview_java_deployment', { artifact, target });
}
export function deployJavaArtifact(payload: JavaDeploy, request?: SaveCommandRequest) {
  return invokeSaveCommand<WriteResult>('deploy_java_artifact', { payload }, [], request);
}
