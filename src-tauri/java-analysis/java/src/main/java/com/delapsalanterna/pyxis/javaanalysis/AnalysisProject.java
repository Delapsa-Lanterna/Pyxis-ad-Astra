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
import java.util.Set;
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
  final Map<String, String> shadowedSources = new HashMap<>();
  final List<Path> roots = new ArrayList<>();
  final List<Integer> activeRoots = new ArrayList<>();
  final Map<String, CompilationUnit> asts = new LinkedHashMap<>();
  final Map<String, Map<ASTNode, Protocol.SemanticNode>> semanticNodes = new HashMap<>();
  final Map<String, JsonObject> summaries = new HashMap<>();
  final ImpactIndex impact = new ImpactIndex();
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
    language = input.language() == null ? Versions.LANGUAGE : input.language();
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
      activeRoots.add(roots.size() - 1);
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
    impact.classpath(input.classpath());
    for (int index : activeRoots) loadRoot(index);
  }

  private void loadRoot(int index) throws Exception {
    Path source = roots.get(index);
    List<Path> files;
    try (var entries = Files.walk(source)) {
      files =
          entries
              .filter(p -> Files.isRegularFile(p) && p.toString().endsWith(".java"))
              .sorted()
              .toList();
    }
    for (Path file : files) {
      Path relative = source.relativize(file);
      String key = file.toRealPath().toString();
      if (copies.containsKey(key)) continue;
      IFile privateFile = resourceFile(index, relative.toString().replace('\\', '/'));
      createParents(privateFile);
      byte[] bytes = Files.readAllBytes(file);
      try (var contents = new ByteArrayInputStream(bytes)) {
        privateFile.create(contents, IResource.FORCE, null);
      }
      String text = new String(bytes, StandardCharsets.UTF_8);
      register(key, privateFile, text, 1L);
      impact.changed(key, text, language);
    }
  }

  String key(String file) throws Exception {
    Path path = Path.of(file).toAbsolutePath().normalize();
    Path existing = path;
    while (!Files.exists(existing)) existing = existing.getParent();
    return existing.toRealPath().resolve(existing.relativize(path)).toString();
  }

  JsonObject update(long expectedRevision, List<Protocol.FileChange> files) throws Exception {
    if (expectedRevision != revision)
      throw new Protocol.Failure("engine.stale_project", "Project revision is stale", null, null);
    record Change(String action, String file, String target, String source, long version) {}
    List<Change> changes = new ArrayList<>();
    Map<String, Long> nextVersions = new HashMap<>();
    Map<String, Boolean> sources = new HashMap<>();
    Map<String, Boolean> targets = new HashMap<>();
    for (Protocol.FileChange file : files) {
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
        if (!resources.containsKey(from))
          throw new IllegalArgumentException("Unknown source file: " + from);
        long next = file.version();
        if (next <= versions.get(from))
          throw new Protocol.Failure(
              "engine.stale_document", "Document version must increase", from, null);
        nextVersions.put(from, next);
      }
      if (action.equals("add") || action.equals("move")) {
        rootIndex(target);
        if (resources.containsKey(target) && !target.equals(from))
          throw new IllegalArgumentException("Target file already exists: " + target);
        if (targets.put(target, true) != null)
          throw new IllegalArgumentException("Duplicate target file: " + target);
        if (file.source() == null)
          throw new IllegalArgumentException("Source text is required: " + target);
      }
      if (action.equals("add") && resources.containsKey(from))
        throw new IllegalArgumentException("File already exists: " + from);
      if (action.equals("replace") && !resources.containsKey(from))
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
      if (change.action().equals("delete") || change.action().equals("move"))
        impact.changed(change.file(), null, language);
      if (change.action().equals("add")
          || change.action().equals("move")
          || change.action().equals("replace"))
        impact.changed(change.target(), change.source(), language);
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
        if (shadowedSources.containsKey(change.file()))
          shadowedSources.put(change.file(), change.source());
        else copies.get(change.file()).getBuffer().setContents(change.source());
        versions.put(change.file(), change.version());
      } else if (!change.action().equals("delete"))
        throw new IllegalArgumentException("Unknown file change: " + change.action());
    }
    nextVersions.forEach(
        (file, version) -> {
          if (resources.containsKey(file)) versions.put(file, version);
        });
    revision++;
    analyzedRevision = 0;
    return identity();
  }

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
    ICompilationUnit unit = copies.remove(key);
    if (unit != null) unit.discardWorkingCopy();
    shadowedSources.remove(key);
    versions.remove(key);
    resources.remove(key).delete(true, null);
    impact.remove(key);
    asts.remove(key);
    semanticNodes.remove(key);
    summaries.remove(key);
  }

  private int rootIndex(String key) {
    Path path = Path.of(key);
    for (int index : activeRoots) if (path.startsWith(roots.get(index))) return index;
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

  void analyze() throws Exception {
    if (analyzedRevision == revision) return;
    long started = System.nanoTime();
    Set<String> chosen = new java.util.HashSet<>();
    for (int index : activeRoots)
      for (var entry : new ArrayList<>(resources.entrySet())) {
        Path file = Path.of(entry.getKey());
        if (!file.startsWith(roots.get(index))) continue;
        String relative = roots.get(index).relativize(file).toString();
        if (chosen.add(relative)) {
          if (shadowedSources.containsKey(entry.getKey())) {
            String source = shadowedSources.remove(entry.getKey());
            register(entry.getKey(), entry.getValue(), source, versions.get(entry.getKey()));
            impact.changed(entry.getKey(), source, language);
          }
        } else if (copies.containsKey(entry.getKey())) {
          ICompilationUnit unit = copies.remove(entry.getKey());
          shadowedSources.put(entry.getKey(), unit.getSource());
          unit.discardWorkingCopy();
          asts.remove(entry.getKey());
          semanticNodes.remove(entry.getKey());
          summaries.remove(entry.getKey());
          impact.remove(entry.getKey());
        }
      }
    Set<String> targets = impact.affected(copies.keySet());
    int invalidated = targets.size();
    targets.retainAll(copies.keySet());
    asts.keySet().removeIf(file -> !copies.containsKey(file));
    Map<ICompilationUnit, String> names = new HashMap<>();
    copies.forEach((name, unit) -> names.put(unit, name));
    Map<String, CompilationUnit> result = new LinkedHashMap<>();
    SemanticSnapshot snapshot = new SemanticSnapshot();
    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setProject(javaProject);
    parser.setWorkingCopyOwner(owner);
    parser.setResolveBindings(true);
    parser.setBindingsRecovery(true);
    parser.setStatementsRecovery(true);
    parser.createASTs(
        targets.stream().map(copies::get).toArray(ICompilationUnit[]::new),
        new String[0],
        new ASTRequestor() {
          @Override
          public void acceptAST(ICompilationUnit source, CompilationUnit ast) {
            String file = names.get(source);
            result.put(file, ast);
            impact.index(file, versions.get(file), ast);
            // Materialize JDT's lazy bindings before its compiler disposes class scopes.
            Map<ASTNode, Protocol.SemanticNode> nodes = new java.util.IdentityHashMap<>();
            String text;
            try {
              text = source.getSource();
            } catch (JavaModelException error) {
              throw new IllegalStateException(error);
            }
            ast.accept(
                new ASTVisitor() {
                  @Override
                  public void preVisit(ASTNode node) {
                    if (node.getStartPosition() >= 0
                        && node.getStartPosition() + node.getLength() <= text.length()
                        && (node instanceof Name
                            || node instanceof Expression
                            || node instanceof Type
                            || node instanceof MethodDeclaration
                            || node instanceof AbstractTypeDeclaration
                            || node instanceof VariableDeclaration
                            || AstFacts.callGroup(node) != null)) {
                      nodes.put(node, snapshot.node(node, text));
                    }
                  }
                });
            semanticNodes.put(file, nodes);
            JsonObject summary = AstFacts.summarize(Map.of(file, ast));
            summary.add("outline", EditorQueries.outline(ast));
            summaries.put(file, summary);
          }
        },
        null);
    asts.putAll(result);
    analyzedRevision = revision;
    parseBatches++;
    impact.completed(targets.size(), invalidated, started);
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
    List<Integer> additions = new ArrayList<>();
    List<Integer> previousRoots = new ArrayList<>(activeRoots);
    if (input.sources() != null) {
      activeRoots.clear();
      for (String raw : input.sources()) {
        Path path = Path.of(raw).toRealPath();
        int index = roots.indexOf(path);
        if (index < 0) {
          index = roots.size();
          roots.add(path);
          resource.getFolder("source" + index).create(true, true, null);
          additions.add(index);
        } else if (!copies.keySet().stream().anyMatch(file -> Path.of(file).startsWith(path)))
          additions.add(index);
        activeRoots.add(index);
      }
      if (previousRoots.size() == activeRoots.size() && !previousRoots.equals(activeRoots))
        impact
            .files
            .values()
            .forEach(facts -> impact.changedSymbols.addAll(facts.shape().declarations()));
    }
    for (int index : activeRoots)
      classpath.add(JavaCore.newSourceEntry(resource.getFolder("source" + index).getFullPath()));
    for (String jar : input.classpath())
      classpath.add(
          JavaCore.newLibraryEntry(
              org.eclipse.core.runtime.Path.fromOSString(Path.of(jar).toRealPath().toString()),
              null,
              null));
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
    for (String file : new ArrayList<>(resources.keySet()))
      if (activeRoots.stream().noneMatch(index -> Path.of(file).startsWith(roots.get(index)))) {
        impact.changed(file, null, language);
        remove(file);
      }
    for (int index : additions) loadRoot(index);
    if (!language.equals(nextLanguage) || !javaHome.equals(nextJavaHome))
      impact.fallback = "language_or_standard_library_changed";
    language = nextLanguage;
    javaHome = nextJavaHome;
    impact.classpath(input.classpath());
    if (impact.fallback != null) impact.dirty.addAll(copies.keySet());
    revision++;
    analyzedRevision = 0;
    return identity();
  }

  JsonObject summary() throws Exception {
    analyze();
    JsonObject result = new JsonObject();
    JsonArray diagnostics = new JsonArray();
    JsonArray failures = new JsonArray();
    for (String file : copies.keySet()) {
      JsonObject part = summaries.get(file);
      if (part == null) continue;
      for (var entry : part.entrySet()) {
        if (entry.getValue().isJsonPrimitive())
          result.addProperty(
              entry.getKey(),
              (result.has(entry.getKey()) ? result.get(entry.getKey()).getAsInt() : 0)
                  + entry.getValue().getAsInt());
      }
      for (var diagnostic : part.getAsJsonArray("diagnostics"))
        diagnostics.add(diagnostic.deepCopy());
      for (var failure : part.getAsJsonArray("bindingFailures")) failures.add(failure.deepCopy());
    }
    result.addProperty("files", copies.size());
    if (!result.has("errors")) result.addProperty("errors", 0);
    result.add("diagnostics", diagnostics);
    result.add("bindingFailures", failures);
    for (var raw : result.getAsJsonArray("diagnostics")) {
      JsonObject diagnostic = raw.getAsJsonObject();
      diagnostic.addProperty("version", versions.get(diagnostic.get("file").getAsString()));
    }
    result.addProperty("revision", revision);
    result.addProperty("parseBatches", parseBatches);
    result.addProperty("referenceIndexBuilds", impact.indexBuilds);
    Runtime memory = Runtime.getRuntime();
    result.addProperty("heapUsedBytes", memory.totalMemory() - memory.freeMemory());
    result.addProperty("heapCommittedBytes", memory.totalMemory());
    return impact.statistics(result);
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
    if (unit == null)
      throw new Protocol.Failure(
          "engine.source_unavailable",
          "File is outside the active Java source selection",
          file,
          input.offset());
    ICompilationUnit sourceUnit = copies.get(file);
    if (offset < 0 || offset >= sourceUnit.getBuffer().getLength())
      throw new IllegalArgumentException("Offset is outside source");
    ASTNode selected = NodeFinder.perform(unit, offset, 0);
    ASTNode call = selected;
    while (call != null && AstFacts.callGroup(call) == null) call = call.getParent();
    Protocol.SemanticNode selectedFacts = semanticNodes.get(file).get(selected);
    if (selectedFacts == null)
      selectedFacts = new SemanticSnapshot().node(selected, sourceUnit.getSource());
    var binding = selectedFacts.binding();
    String target = binding == null ? null : binding.key();
    JsonArray declarations = new JsonArray();
    JsonArray references = new JsonArray();
    if (target != null) {
      for (var location : impact.locations(target)) {
        JsonObject copy = location.deepCopy();
        if (copy.get("declaration").getAsBoolean()) declarations.add(copy);
        else references.add(copy);
      }
    }
    JsonObject result =
        AstFacts.object(
            "revision",
            revision,
            "version",
            versions.get(file),
            "file",
            file,
            "node",
            Protocol.JSON.toJsonTree(selectedFacts),
            "call",
            call == null ? null : Protocol.JSON.toJsonTree(semanticNodes.get(file).get(call)),
            "declarations",
            declarations,
            "references",
            references);
    return impact.statistics(result);
  }

  @Override
  public void close() throws Exception {
    for (ICompilationUnit unit : copies.values()) unit.discardWorkingCopy();
    copies.clear();
    asts.clear();
    semanticNodes.clear();
    summaries.clear();
    impact.files.clear();
    impact.references.clear();
    impact.archives.clear();
    resources.clear();
    versions.clear();
    resource.delete(true, true, null);
  }
}
