package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.core.resources.*;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;

/** Owns a workspace project and its unsaved compilation units. */
final class AnalysisProject implements AutoCloseable {
  final IProject resource;
  final IJavaProject javaProject;
  final WorkingCopyOwner owner = new WorkingCopyOwner() {};
  final Map<String, ICompilationUnit> copies = new LinkedHashMap<>();
  final Map<String, Long> versions = new HashMap<>();
  final Map<String, IFile> resources = new HashMap<>();
  final List<Path> roots = new ArrayList<>();
  final Map<String, CompilationUnit> asts = new LinkedHashMap<>();
  String language;
  Path javaHome;
  long revision = 1;
  long analyzedRevision;
  int parseBatches;

  static Map<String, String> options(String language) {
    Map<String, String> options = new HashMap<>();
    JavaCore.setComplianceOptions(language, options);
    options.put(JavaCore.COMPILER_DOC_COMMENT_SUPPORT, JavaCore.ENABLED);
    return options;
  }

  AnalysisProject(String workspaceName, Protocol.Request input) throws Exception {
    language = input.language() == null ? "17" : input.language();
    resource = ResourcesPlugin.getWorkspace().getRoot().getProject(workspaceName);
    resource.create(null);
    resource.open(null);
    IProjectDescription description = resource.getDescription();
    description.setNatureIds(new String[] {JavaCore.NATURE_ID});
    resource.setDescription(description, null);
    resource.setDefaultCharset("UTF-8", null);
    javaProject = JavaCore.create(resource);
    javaProject.setOptions(options(language));
    List<IClasspathEntry> classpath = new ArrayList<>();
    for (String raw : input.sources()) {
      Path source = Path.of(raw).toRealPath();
      IFolder sourceFolder = resource.getFolder("source" + roots.size());
      sourceFolder.create(true, true, null);
      roots.add(source);
      classpath.add(JavaCore.newSourceEntry(sourceFolder.getFullPath()));
    }
    for (String jar : input.classpath())
      classpath.add(
          JavaCore.newLibraryEntry(
              org.eclipse.core.runtime.Path.fromOSString(Path.of(jar).toRealPath().toString()),
              null,
              null));
    javaHome = Path.of(input.javaHome()).toRealPath();
    classpath.add(
        JavaCore.newLibraryEntry(
            org.eclipse.core.runtime.Path.fromOSString(
                javaHome.resolve("lib/jrt-fs.jar").toString()),
            null,
            null));
    javaProject.setRawClasspath(
        classpath.toArray(IClasspathEntry[]::new), resource.getFullPath().append("bin"), null);
    for (int index = 0; index < roots.size(); index++) {
      Path source = roots.get(index);
      List<Path> files;
      try (var entries = Files.walk(source)) {
        files = entries.filter(p -> p.toString().endsWith(".java")).sorted().toList();
      }
      for (Path file : files) {
        Path relative = source.relativize(file);
        String key = file.toRealPath().toString();
        IFile privateFile = resourceFile(index, relative.toString().replace('\\', '/'));
        createParents(privateFile);
        byte[] bytes = Files.readAllBytes(file);
        try (var contents = new ByteArrayInputStream(bytes)) {
          privateFile.create(contents, IResource.FORCE, null);
        }
        register(key, privateFile, new String(bytes, StandardCharsets.UTF_8), 1L);
      }
    }
  }

  String key(String file) throws Exception {
    Path path = Path.of(file).toAbsolutePath().normalize();
    Path existing = path;
    while (!Files.exists(existing)) existing = existing.getParent();
    return existing.toRealPath().resolve(existing.relativize(path)).toString();
  }

  JsonObject update(Protocol.Request input) throws Exception {
    if (input.expectedRevision() != revision)
      throw new Protocol.Failure("engine.stale_project", "Project revision is stale", null, null);
    record Change(String action, String file, String target, String source, long version) {}
    List<Change> changes = new ArrayList<>();
    Map<String, Long> nextVersions = new HashMap<>();
    Map<String, Boolean> sources = new HashMap<>();
    Map<String, Boolean> targets = new HashMap<>();
    for (Protocol.FileChange file : input.files()) {
      String action = file.action();
      String from = key(file.file());
      String target = file.target() == null ? from : key(file.target());
      if (sources.put(from, true) != null)
        throw new IllegalArgumentException(
            "File appears more than once in a change batch: " + from);
      if (!List.of("add", "replace", "delete", "move").contains(action))
        throw new IllegalArgumentException("Unknown file change: " + action);
      if (!from.endsWith(".java") || !target.endsWith(".java"))
        throw new Protocol.Failure(
            "engine.invalid_file", "Source paths must end in .java", from, null);
      if (file.version() == null || file.version() <= 0)
        throw new Protocol.Failure(
            "engine.invalid_version", "Document version must be positive", from, null);
      if (!action.equals("delete") && file.source() == null)
        throw new Protocol.Failure("engine.source_required", "Source text is required", from, null);
      if (action.equals("delete") || action.equals("move")) {
        if (!copies.containsKey(from))
          throw new IllegalArgumentException("Unknown source file: " + from);
        long next = file.version();
        if (next <= versions.get(from))
          throw new Protocol.Failure(
              "engine.stale_document", "Document version must increase", from, null);
        nextVersions.put(from, next);
      }
      if (action.equals("add") || action.equals("move")) {
        rootIndex(target);
        if (copies.containsKey(target) && !target.equals(from))
          throw new IllegalArgumentException("Target file already exists: " + target);
        if (targets.put(target, true) != null)
          throw new IllegalArgumentException("Duplicate target file: " + target);
        if (file.source() == null)
          throw new IllegalArgumentException("Source text is required: " + target);
      }
      if (action.equals("add") && copies.containsKey(from))
        throw new IllegalArgumentException("File already exists: " + from);
      if (action.equals("replace") && !copies.containsKey(from))
        throw new IllegalArgumentException("Unknown source file: " + from);
      if (action.equals("replace") && file.version() <= versions.get(from))
        throw new Protocol.Failure(
            "engine.stale_document", "Document version must increase", from, null);
      changes.add(
          new Change(
              action, from, target, file.source(), file.version() == null ? 1L : file.version()));
    }
    Map<String, Boolean> destinations = new HashMap<>();
    for (Change change : changes) {
      if (change.action().equals("delete") || change.action().equals("replace")) continue;
      destinations.put(change.target(), true);
      if (!change.file().equals(change.target()) && sources.containsKey(change.target()))
        throw new Protocol.Failure(
            "engine.conflicting_changes",
            "A move target is also changed in this batch",
            change.target(),
            null);
      IFile destination =
          resourceFile(
              rootIndex(change.target()), relative(rootIndex(change.target()), change.target()));
      IContainer parent = destination.getParent();
      while (parent instanceof IFolder folder) {
        if (resource.getFile(folder.getProjectRelativePath()).exists())
          throw new Protocol.Failure(
              "engine.invalid_file",
              "A source file occupies the destination parent",
              change.target(),
              null);
        parent = parent.getParent();
      }
    }
    for (String destination : destinations.keySet())
      for (String other : destinations.keySet())
        if (!destination.equals(other) && Path.of(destination).startsWith(Path.of(other)))
          throw new Protocol.Failure(
              "engine.conflicting_changes",
              "A file is also a destination parent",
              destination,
              null);
    for (Change change : changes) {
      if (change.action().equals("delete") || change.action().equals("move")) remove(change.file());
      if (change.action().equals("add") || change.action().equals("move")) {
        IFile target =
            resourceFile(
                rootIndex(change.target()), relative(rootIndex(change.target()), change.target()));
        createParents(target);
        target.create(
            new ByteArrayInputStream(change.source().getBytes(StandardCharsets.UTF_8)),
            IResource.FORCE,
            null);
        register(change.target(), target, change.source(), change.version());
      } else if (change.action().equals("replace")) {
        copies.get(change.file()).getBuffer().setContents(change.source());
        versions.put(change.file(), change.version());
      } else if (!change.action().equals("delete"))
        throw new IllegalArgumentException("Unknown file change: " + change.action());
    }
    nextVersions.forEach(
        (file, version) -> {
          if (copies.containsKey(file)) versions.put(file, version);
        });
    revision++;
    asts.clear();
    referenceIndex.clear();
    return identity();
  }

  final Map<String, List<JsonObject>> referenceIndex = new HashMap<>();
  int indexBuilds;
  long indexedRevision;

  private void register(String key, IFile file, String source, long version) throws Exception {
    ICompilationUnit unit =
        javaProject
            .getPackageFragmentRoot(resource.getFolder("source" + rootIndexFor(file)))
            .getPackageFragment(packageName(file))
            .getCompilationUnit(file.getName())
            .getWorkingCopy(owner, null);
    unit.getBuffer().setContents(source);
    copies.put(key, unit);
    versions.put(key, version);
    resources.put(key, file);
  }

  private void remove(String key) throws Exception {
    copies.remove(key).discardWorkingCopy();
    versions.remove(key);
    resources.remove(key).delete(true, null);
  }

  private int rootIndex(String key) {
    Path path = Path.of(key);
    for (int index = 0; index < roots.size(); index++)
      if (path.startsWith(roots.get(index))) return index;
    throw new IllegalArgumentException("File is outside project source roots: " + key);
  }

  private String relative(int index, String key) {
    return roots.get(index).relativize(Path.of(key)).toString().replace('\\', '/');
  }

  private IFile resourceFile(int index, String relative) {
    return resource.getFile("source" + index + "/" + relative);
  }

  private void createParents(IFile file) throws Exception {
    IContainer parent = file.getParent();
    if (parent instanceof IFolder folder && !folder.exists()) createParents(folder);
  }

  private void createParents(IFolder folder) throws Exception {
    IContainer parent = folder.getParent();
    if (parent instanceof IFolder parentFolder && !parentFolder.exists())
      createParents(parentFolder);
    folder.create(true, true, null);
  }

  private String packageName(IFile file) {
    return file.getParent()
        .getProjectRelativePath()
        .removeFirstSegments(1)
        .toString()
        .replace('/', '.');
  }

  private int rootIndexFor(IFile file) {
    return Integer.parseInt(file.getProjectRelativePath().segment(0).substring("source".length()));
  }

  void analyze() {
    if (analyzedRevision == revision) return;
    Map<ICompilationUnit, String> names = new HashMap<>();
    copies.forEach((name, unit) -> names.put(unit, name));
    Map<String, CompilationUnit> result = new LinkedHashMap<>();
    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setProject(javaProject);
    parser.setWorkingCopyOwner(owner);
    parser.setResolveBindings(true);
    parser.setBindingsRecovery(true);
    parser.setStatementsRecovery(true);
    parser.createASTs(
        copies.values().toArray(ICompilationUnit[]::new),
        new String[0],
        new ASTRequestor() {
          @Override
          public void acceptAST(ICompilationUnit source, CompilationUnit ast) {
            result.put(names.get(source), ast);
          }
        },
        null);
    asts.clear();
    asts.putAll(result);
    analyzedRevision = revision;
    parseBatches++;
  }

  JsonObject identity() {
    return AstFacts.object(
        "revision", revision, "files", copies.size(), "parseBatches", parseBatches);
  }

  JsonObject configure(Protocol.Request input) throws Exception {
    if (input.expectedRevision() != revision)
      throw new Protocol.Failure("engine.stale_project", "Project revision is stale", null, null);
    String nextLanguage = input.language();
    Path nextJavaHome = Path.of(input.javaHome()).toRealPath();
    List<IClasspathEntry> classpath = new ArrayList<>();
    for (String jar : input.classpath())
      classpath.add(
          JavaCore.newLibraryEntry(
              org.eclipse.core.runtime.Path.fromOSString(Path.of(jar).toRealPath().toString()),
              null,
              null));
    for (int index = 0; index < roots.size(); index++)
      classpath.add(JavaCore.newSourceEntry(resource.getFolder("source" + index).getFullPath()));
    classpath.add(
        JavaCore.newLibraryEntry(
            org.eclipse.core.runtime.Path.fromOSString(
                nextJavaHome.resolve("lib/jrt-fs.jar").toString()),
            null,
            null));
    javaProject.setRawClasspath(
        classpath.toArray(IClasspathEntry[]::new), resource.getFullPath().append("bin"), null);
    javaProject.setOptions(options(nextLanguage));
    for (IPackageFragmentRoot root : javaProject.getPackageFragmentRoots())
      if (root.isArchive()) root.close();
    javaProject.getJavaModel().refreshExternalArchives(new IJavaElement[] {javaProject}, null);
    language = nextLanguage;
    javaHome = nextJavaHome;
    revision++;
    analyzedRevision = 0;
    asts.clear();
    referenceIndex.clear();
    return identity();
  }

  JsonObject summary() {
    analyze();
    JsonObject result = AstFacts.summarize(asts);
    for (var raw : result.getAsJsonArray("diagnostics")) {
      JsonObject diagnostic = raw.getAsJsonObject();
      diagnostic.addProperty("version", versions.get(diagnostic.get("file").getAsString()));
    }
    result.addProperty("revision", revision);
    result.addProperty("parseBatches", parseBatches);
    result.addProperty("referenceIndexBuilds", indexBuilds);
    Runtime memory = Runtime.getRuntime();
    result.addProperty("heapUsedBytes", memory.totalMemory() - memory.freeMemory());
    result.addProperty("heapCommittedBytes", memory.totalMemory());
    return result;
  }

  JsonObject query(Protocol.Request input) throws Exception {
    long expected = input.revision();
    if (expected != revision)
      throw new Protocol.Failure(
          "engine.stale_project", "Project revision is stale", input.file(), input.offset());
    analyze();
    String file = key(input.file());
    int offset = input.offset();
    CompilationUnit unit = asts.get(file);
    if (unit == null) throw new IllegalArgumentException("File is outside project");
    String source = copies.get(file).getSource();
    if (offset < 0 || offset >= source.length())
      throw new IllegalArgumentException("Offset is outside source");
    ASTNode selected = NodeFinder.perform(unit, offset, 0);
    ASTNode call = selected;
    while (call != null && AstFacts.callGroup(call) == null) call = call.getParent();
    IBinding binding = AstFacts.binding(selected);
    String target = binding == null ? null : AstFacts.declaration(binding).getKey();
    JsonArray declarations = new JsonArray();
    JsonArray references = new JsonArray();
    if (target != null) {
      if (indexedRevision != revision) buildReferenceIndex();
      for (var location : referenceIndex.getOrDefault(target, List.of())) {
        JsonObject copy = location.deepCopy();
        if (copy.get("declaration").getAsBoolean()) declarations.add(copy);
        else references.add(copy);
      }
    }
    return AstFacts.object(
        "revision",
        revision,
        "version",
        versions.get(file),
        "file",
        file,
        "node",
        AstFacts.node(selected, source),
        "call",
        call == null ? null : AstFacts.node(call, source),
        "declarations",
        declarations,
        "references",
        references);
  }

  private void buildReferenceIndex() {
    referenceIndex.clear();
    for (var entry : asts.entrySet())
      entry
          .getValue()
          .accept(
              new ASTVisitor() {
                @Override
                public boolean visit(SimpleName name) {
                  IBinding found = name.resolveBinding();
                  if (found != null) {
                    String key = AstFacts.declaration(found).getKey();
                    if (key != null)
                      referenceIndex
                          .computeIfAbsent(key, ignored -> new ArrayList<>())
                          .add(
                              AstFacts.object(
                                  "file",
                                  entry.getKey(),
                                  "version",
                                  versions.get(entry.getKey()),
                                  "range",
                                  AstFacts.range(name),
                                  "declaration",
                                  name.isDeclaration()));
                  }
                  return true;
                }
              });
    indexBuilds++;
    indexedRevision = revision;
  }

  @Override
  public void close() throws Exception {
    for (ICompilationUnit unit : copies.values()) unit.discardWorkingCopy();
    copies.clear();
    asts.clear();
    referenceIndex.clear();
    resources.clear();
    versions.clear();
    resource.delete(true, true, null);
  }
}
