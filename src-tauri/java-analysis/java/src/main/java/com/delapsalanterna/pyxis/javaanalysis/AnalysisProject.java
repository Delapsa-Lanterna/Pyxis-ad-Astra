package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
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
  final Map<String, CompilationUnit> asts = new LinkedHashMap<>();
  final String language;
  long revision = 1;
  long analyzedRevision;
  int parseBatches;

  static Map<String, String> options(String language) {
    Map<String, String> options = new HashMap<>();
    JavaCore.setComplianceOptions(language, options);
    options.put(JavaCore.COMPILER_DOC_COMMENT_SUPPORT, JavaCore.ENABLED);
    return options;
  }

  AnalysisProject(String workspaceName, JsonObject input) throws Exception {
    language = input.has("language") ? input.get("language").getAsString() : "17";
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
    List<IPackageFragmentRoot> roots = new ArrayList<>();
    List<Path> paths = new ArrayList<>();
    for (var raw : input.getAsJsonArray("sources")) {
      Path source = Path.of(raw.getAsString()).toRealPath();
      IFolder link = resource.getFolder("source" + roots.size());
      link.createLink(source.toUri(), IResource.NONE, null);
      roots.add(javaProject.getPackageFragmentRoot(link));
      paths.add(source);
      classpath.add(JavaCore.newSourceEntry(link.getFullPath()));
    }
    for (var jar : input.getAsJsonArray("classpath"))
      classpath.add(
          JavaCore.newLibraryEntry(
              org.eclipse.core.runtime.Path.fromOSString(
                  Path.of(jar.getAsString()).toRealPath().toString()),
              null,
              null));
    Path javaHome = Path.of(input.get("javaHome").getAsString()).toRealPath();
    classpath.add(
        JavaCore.newLibraryEntry(
            org.eclipse.core.runtime.Path.fromOSString(
                javaHome.resolve("lib/jrt-fs.jar").toString()),
            null,
            null));
    javaProject.setRawClasspath(
        classpath.toArray(IClasspathEntry[]::new), resource.getFullPath().append("bin"), null);
    for (int index = 0; index < paths.size(); index++) {
      Path source = paths.get(index);
      List<Path> files;
      try (var entries = Files.walk(source)) {
        files = entries.filter(p -> p.toString().endsWith(".java")).sorted().toList();
      }
      for (Path file : files) {
        Path relative = source.relativize(file);
        String packageName =
            relative.getParent() == null
                ? ""
                : relative.getParent().toString().replace('\\', '.').replace('/', '.');
        ICompilationUnit unit =
            roots
                .get(index)
                .getPackageFragment(packageName)
                .getCompilationUnit(file.getFileName().toString())
                .getWorkingCopy(owner, null);
        String key = file.toRealPath().toString();
        copies.put(key, unit);
        versions.put(key, 1L);
      }
    }
  }

  String key(String file) throws Exception {
    return Path.of(file).toRealPath().toString();
  }

  JsonObject update(JsonObject input) throws Exception {
    Map<String, String> pending = new LinkedHashMap<>();
    Map<String, Long> nextVersions = new LinkedHashMap<>();
    for (var raw : input.getAsJsonArray("files")) {
      JsonObject file = raw.getAsJsonObject();
      String key = key(file.get("file").getAsString());
      long next = file.get("version").getAsLong();
      if (!copies.containsKey(key))
        throw new IllegalArgumentException("File is outside the project's source units: " + key);
      if (next <= versions.get(key))
        throw new IllegalArgumentException("Document version must increase: " + key);
      pending.put(key, file.get("source").getAsString());
      nextVersions.put(key, next);
    }
    for (var file : pending.entrySet())
      copies.get(file.getKey()).getBuffer().setContents(file.getValue());
    versions.putAll(nextVersions);
    revision++;
    asts.clear();
    return identity();
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

  JsonObject summary() {
    analyze();
    JsonObject result = AstFacts.summarize(asts);
    result.addProperty("revision", revision);
    result.addProperty("parseBatches", parseBatches);
    return result;
  }

  JsonObject query(JsonObject input) throws Exception {
    long expected = input.get("revision").getAsLong();
    if (expected != revision) throw new IllegalArgumentException("Project revision is stale");
    analyze();
    String file = key(input.get("file").getAsString());
    int offset = input.get("offset").getAsInt();
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
    if (target != null)
      for (var entry : asts.entrySet())
        entry
            .getValue()
            .accept(
                new ASTVisitor() {
                  @Override
                  public boolean visit(SimpleName name) {
                    IBinding found = name.resolveBinding();
                    if (found != null && target.equals(AstFacts.declaration(found).getKey())) {
                      JsonObject location =
                          AstFacts.object("file", entry.getKey(), "range", AstFacts.range(name));
                      if (name.isDeclaration()) declarations.add(location);
                      else references.add(location);
                    }
                    return true;
                  }
                });
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

  @Override
  public void close() throws Exception {
    for (ICompilationUnit unit : copies.values()) unit.discardWorkingCopy();
    copies.clear();
    asts.clear();
    resource.delete(false, true, null);
  }
}
