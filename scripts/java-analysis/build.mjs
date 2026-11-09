import { mkdir, readFile, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { root, component, output, resources, writeJson, sha256, run, javaTool, mavenArguments, versions } from './runtime.mjs';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, cache: { type: 'string' } } });
const cache = values.cache ?? join(output, 'cache/maven');
if (values['dry-run']) {
  console.log(JSON.stringify({ component, output, resources, java: javaTool('java'), cache }));
} else {
  const env = { ...process.env, JAVA_HOME: process.env.AST_JDK ?? process.env.JAVA_HOME };
  await run(
    'maven-package',
    javaTool('java'),
    [
      ...mavenArguments(),
      '-B',
      '-ntp',
      '-Dmaven.repo.local=' + cache,
      '-Drevision=' + versions.engine,
      '-Danalysis.protocol=' + versions.protocol,
      '-Danalysis.java=' + versions.java,
      '-Danalysis.language=' + versions.language,
      '-Danalysis.jdt=' + versions.jdt,
      '-f',
      join(component, 'java/pom.xml'),
      'package',
    ],
    env,
  );
  /** @type {{artifacts:{path:string,url:string,bytes:number,sha256:string,bundle?:string}[]}} */
  const lock = JSON.parse((await readFile(join(resources, 'dependencies.lock.json'), 'utf8')).replaceAll('${jdt}', versions.jdt));
  const thirdParty = join(output, 'dependencies');
  await mkdir(join(thirdParty, 'lib'), { recursive: true });
  const artifacts = [];
  for (const item of lock.artifacts) {
    const data = await readFile(join(output, 'java/lib', item.path.slice(4)));
    if (data.length !== item.bytes || sha256(data) !== item.sha256) throw new Error('Dependency differs from lock: ' + item.path);
    await writeJson(join(output, 'dependency-check.json'), { checked: artifacts.length + 1, last: item.path });
    await copyFile(join(output, 'java/lib', item.path.slice(4)), join(thirdParty, item.path));
    artifacts.push({ path: item.path, url: item.url, bytes: item.bytes, sha256: item.sha256 });
  }
  const bundles = lock.artifacts.filter((item) => item.bundle).map((item) => item.path);
  const version =
    'jdt-' +
    versions.jdt +
    '-' +
    sha256(JSON.stringify(artifacts.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })))).slice(0, 16);
  const dependencies = {
    version,
    protocol: versions.protocol,
    java: versions.java,
    bundles,
    files: artifacts.map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash })),
  };
  await writeJson(join(thirdParty, 'engine.json'), dependencies);
  const offline = join(output, 'jdt-dependencies.zip');
  await run('dependency-archive', javaTool('jar'), [
    '--create',
    '--file',
    offline,
    '--no-manifest',
    '--date=2026-11-08T00:00:00Z',
    '-C',
    thirdParty,
    'engine.json',
    '-C',
    thirdParty,
    'lib',
  ]);
  const archive = await readFile(offline);
  const catalog = {
    version,
    protocol: versions.protocol,
    java: versions.java,
    bytes: archive.length,
    sha256: sha256(archive),
    artifacts,
    bundles,
  };
  await mkdir(resources, { recursive: true });
  for (const entry of [
    { from: 'java-analysis-' + versions.engine + '.jar', to: 'engine.jar' },
    { from: 'java-analysis-' + versions.engine + '-launcher.jar', to: 'launcher.jar' },
  ])
    await copyFile(join(output, 'java', entry.from), join(resources, entry.to));
  const ownFiles = await Promise.all(
    ['engine.jar', 'launcher.jar'].map(async (path) => {
      const data = await readFile(join(resources, path));
      return { path, bytes: data.length, sha256: sha256(data) };
    }),
  );
  await writeJson(join(resources, 'catalog.json'), catalog);
  await writeJson(join(resources, 'builtin.json'), {
    version: versions.engine,
    protocol: versions.protocol,
    java: versions.java,
    launcher: 'launcher.jar',
    bundle: 'engine.jar',
    framework: 'lib/org.eclipse.osgi-3.24.300.jar',
    dependencies,
    files: ownFiles,
  });
  await run('java-bytecode', javaTool('java'), [
    join(root, 'scripts/java-analysis/VerifyResources.java'),
    String(versions.java),
    resources,
    join(thirdParty, 'lib'),
  ]);
  await writeJson(join(output, 'reports/package.json'), {
    dependencySet: version,
    jars: artifacts.length,
    downloadBytes: artifacts.reduce((n, f) => n + f.bytes, 0),
    builtinJavaBytes: ownFiles.reduce((n, f) => n + f.bytes, 0),
    archiveBytes: (await stat(offline)).size,
  });
}
