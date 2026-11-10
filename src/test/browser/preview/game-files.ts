import { gameRoot, gameFiles, gameImages, gameAudio } from '../sample-data';
const source = import.meta.glob<string>('../game/**/*.{csv,json,ship,skin,variant,wpn,proj,system,skill,faction,txt,java,svg,fnt}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const images = import.meta.glob<string>('../game/**/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true });
const audio = import.meta.glob<string>('../game/**/*.ogg', { query: '?url', import: 'default', eager: true });
for (const [path, text] of Object.entries(source)) gameFiles.set(gameRoot + path.slice('../game'.length), text);
for (const [path, url] of Object.entries(images)) gameImages.set(gameRoot + path.slice('../game'.length), url);
for (const [path, url] of Object.entries(audio)) gameAudio.set(gameRoot + path.slice('../game'.length), url);
export { gameRoot, coreRoot, workspaceRoots, gameFiles, gameImages, gameAudio, gameTablePaths } from '../sample-data';
export { readGameCsv } from '../format';
