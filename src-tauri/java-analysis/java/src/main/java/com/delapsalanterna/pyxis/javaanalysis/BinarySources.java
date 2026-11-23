package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.jar.JarFile;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;

/** Navigation snapshots stay outside the project's source roots and refactoring index. */
final class BinarySources {
  record Document(
      String file,
      String unitName,
      String text,
      String origin,
      String archive,
      String digest,
      String kind) {}

  final Map<String, Document> documents = new HashMap<>();
  private final Map<String, CompilationUnit> parsed = new HashMap<>();
  private long revision;

  CompilationUnit unit(AnalysisProject project, Document document) {
    if (revision != project.revision) {
      parsed.clear();
      revision = project.revision;
    }
    return parsed.computeIfAbsent(
        document.file(),
        ignored -> {
          ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
          parser.setProject(project.javaProject);
          parser.setWorkingCopyOwner(project.owner);
          parser.setUnitName(document.unitName());
          parser.setSource(document.text().toCharArray());
          parser.setResolveBindings(true);
          parser.setBindingsRecovery(true);
          return (CompilationUnit) parser.createAST(null);
        });
  }

  static JsonObject location(Document document, CompilationUnit unit, String key) {
    var node = unit.findDeclaringNode(key);
    SimpleName name =
        node instanceof MethodDeclaration method
            ? method.getName()
            : node instanceof AbstractTypeDeclaration type
                ? type.getName()
                : node instanceof VariableDeclaration variable
                    ? variable.getName()
                    : node instanceof EnumConstantDeclaration value
                        ? value.getName()
                        : node instanceof AnnotationTypeMemberDeclaration member
                            ? member.getName()
                            : null;
    return name == null
        ? null
        : AstFacts.object("file", document.file(), "version", 1, "range", AstFacts.range(name));
  }

  JsonObject declaration(AnalysisProject project, IBinding binding) throws Exception {
    if (binding == null || binding.getJavaElement() == null) return null;
    var element = binding.getJavaElement();
    if (!(element.getAncestor(IJavaElement.CLASS_FILE) instanceof IOrdinaryClassFile file))
      return null;
    IType type = file.getType();
    while (type.getDeclaringType() != null) type = type.getDeclaringType();
    Path path = Path.of(file.getPath().toOSString());
    var archive = project.impact.archives.get(path.toString());
    if (archive == null) return null;
    String className = type.getFullyQualifiedName('$').replace('.', '/');
    String unitName = className + ".java";
    String jarName = path.getFileName().toString();
    Path attachment =
        path.resolveSibling(jarName.substring(0, jarName.length() - 4) + "-sources.jar");
    String prefix = "jar:" + path.toUri() + "!/" + archive.digest() + "/";
    Document document = null;
    if (Files.isRegularFile(attachment)
        && attachment.toRealPath().getParent().equals(path.getParent())) {
      try (var jar = new JarFile(attachment.toFile())) {
        var entry = jar.getJarEntry(unitName);
        if (entry != null) {
          String id = prefix + "sources-" + entry.getCrc() + "/" + unitName;
          document = documents.get(id);
          if (document == null) {
            try (var stream = jar.getInputStream(entry)) {
              document =
                  new Document(
                      id,
                      unitName,
                      new String(stream.readAllBytes(), StandardCharsets.UTF_8),
                      attachment.toString(),
                      path.toString(),
                      archive.digest(),
                      "attached");
            }
          }
        }
      }
    }
    String key = AstFacts.declaration(binding).getKey();
    if (document != null) {
      documents.put(document.file(), document);
      JsonObject target = location(document, unit(project, document), key);
      if (target != null) return target;
    }
    String id = prefix + "classes/" + unitName;
    document = documents.get(id);
    if (document == null) {
      try (var jar = new JarFile(path.toFile(), false, JarFile.OPEN_READ, Runtime.version())) {
        document =
            new Document(
                id,
                unitName,
                ClassDecompiler.source(jar, className, archive),
                path.toString(),
                path.toString(),
                archive.digest(),
                "decompiled");
      }
    }
    documents.put(document.file(), document);
    var ast = unit(project, document);
    var target = location(document, ast, key);
    // Synthetic members can be absent from the Java representation. Open their enclosing type.
    return target != null ? target : location(document, ast, type.getKey());
  }

  void configure(Map<String, ImpactIndex.Archive> archives) {
    documents
        .values()
        .removeIf(
            document -> {
              var archive = archives.get(document.archive());
              return archive == null || !archive.digest().equals(document.digest());
            });
    parsed.clear();
  }
}
