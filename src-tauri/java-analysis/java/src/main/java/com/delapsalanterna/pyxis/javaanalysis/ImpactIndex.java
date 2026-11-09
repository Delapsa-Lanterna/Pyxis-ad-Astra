package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.JsonObject;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;
import java.util.jar.JarFile;
import org.eclipse.jdt.core.dom.*;

/**
 * Tracks source lookup dependencies, including unresolved names that newly added types can satisfy.
 */
final class ImpactIndex {
  record Shape(String signature, Set<String> declarations) {}

  record Facts(Shape shape, Set<String> uses, Set<String> keys) {}

  record Archive(String digest, Map<String, String> classes) {}

  record Location(String file, long version, int start, int end, boolean declaration) {
    JsonObject json() {
      return AstFacts.object(
          "file",
          file,
          "version",
          version,
          "range",
          AstFacts.object("start", start, "end", end),
          "declaration",
          declaration);
    }
  }

  final Map<String, Facts> files = new LinkedHashMap<>();
  final Set<String> dirty = new LinkedHashSet<>();
  final Set<String> changedSymbols = new HashSet<>();
  final Map<String, Map<String, List<Location>>> references = new HashMap<>();
  final Map<String, Archive> archives = new HashMap<>();
  Map<String, String> externalTypes = new LinkedHashMap<>();
  String fallback = "initial_analysis";
  String lastFallback;
  int reparsedFiles;
  int invalidatedFiles;
  int indexBuilds;
  double analysisMilliseconds;

  static CompilationUnit syntax(String source, String language) {
    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setSource(source.toCharArray());
    parser.setCompilerOptions(AnalysisProject.options(language));
    parser.setStatementsRecovery(true);
    return (CompilationUnit) parser.createAST(null);
  }

  static Shape shape(CompilationUnit unit) {
    CompilationUnit declarations = (CompilationUnit) ASTNode.copySubtree(unit.getAST(), unit);
    // Method bodies never define externally callable signatures. Field initializers remain:
    // changing a compilation constant must invalidate its consumers.
    declarations.accept(
        new ASTVisitor() {
          @Override
          public boolean visit(MethodDeclaration method) {
            method.setBody(null);
            return true;
          }

          @Override
          public boolean visit(Initializer initializer) {
            initializer.setBody(unit.getAST().newBlock());
            return false;
          }
        });
    Set<String> names = new HashSet<>();
    declarations.accept(
        new ASTVisitor() {
          @Override
          public boolean visit(SimpleName name) {
            if (name.isDeclaration()) names.add(name.getIdentifier());
            return true;
          }
        });
    return new Shape(declarations.toString(), names);
  }

  void changed(String file, String source, String language) {
    dirty.add(file);
    Facts previous = files.get(file);
    Shape next = source == null ? null : shape(syntax(source, language));
    if (previous == null || next == null || !previous.shape.signature.equals(next.signature)) {
      if (previous != null) changedSymbols.addAll(previous.shape.declarations);
      if (next != null) changedSymbols.addAll(next.declarations);
    }
  }

  Set<String> affected(Set<String> current) {
    if (fallback != null) return new LinkedHashSet<>(current);
    Set<String> result = new LinkedHashSet<>(dirty);
    Set<String> symbols = new HashSet<>(changedSymbols);
    boolean progress;
    do {
      progress = false;
      for (var entry : files.entrySet())
        if (!result.contains(entry.getKey())
            && !Collections.disjoint(entry.getValue().uses, symbols)) {
          result.add(entry.getKey());
          symbols.addAll(entry.getValue().shape.declarations);
          progress = true;
        }
    } while (progress);
    return result;
  }

  void remove(String file) {
    Facts previous = files.remove(file);
    if (previous == null) return;
    for (String key : previous.keys) {
      Map<String, List<Location>> locations = references.get(key);
      locations.remove(file);
      if (locations.isEmpty()) references.remove(key);
    }
  }

  void index(String file, long version, CompilationUnit unit) {
    remove(file);
    Set<String> uses = new HashSet<>();
    Set<String> keys = new HashSet<>();
    unit.accept(
        new ASTVisitor() {
          void type(ITypeBinding type) {
            if (type == null) return;
            uses.add(type.getName());
            uses.add(type.getErasure().getName());
            uses.add(type.getQualifiedName());
            for (ITypeBinding argument : type.getTypeArguments()) {
              uses.add(argument.getName());
              uses.add(argument.getQualifiedName());
            }
          }

          @Override
          public void preVisit(ASTNode node) {
            IBinding binding = AstFacts.binding(node);
            if (binding instanceof IMethodBinding method) {
              type(method.getDeclaringClass());
              type(method.getReturnType());
              for (ITypeBinding parameter : method.getParameterTypes()) type(parameter);
            } else if (binding instanceof IVariableBinding variable) {
              type(variable.getDeclaringClass());
              type(variable.getType());
            } else if (binding instanceof ITypeBinding bound) type(bound);
            if (node instanceof Expression expression) type(expression.resolveTypeBinding());
          }

          @Override
          public boolean visit(SimpleName name) {
            uses.add(name.getIdentifier());
            IBinding binding = name.resolveBinding();
            if (binding != null) {
              String key = AstFacts.declaration(binding).getKey();
              if (key != null) {
                keys.add(key);
                references
                    .computeIfAbsent(key, ignored -> new TreeMap<>())
                    .computeIfAbsent(file, ignored -> new ArrayList<>())
                    .add(
                        new Location(
                            file,
                            version,
                            name.getStartPosition(),
                            name.getStartPosition() + name.getLength(),
                            name.isDeclaration()));
              }
            }
            return true;
          }
        });
    files.put(file, new Facts(shape(unit), uses, keys));
  }

  List<JsonObject> locations(String key) {
    Map<String, List<Location>> found = references.get(key);
    return found == null
        ? List.of()
        : found.values().stream().flatMap(List::stream).map(Location::json).toList();
  }

  static String digest(InputStream input) throws Exception {
    MessageDigest hash = MessageDigest.getInstance("SHA-256");
    byte[] bytes = new byte[65536];
    for (int count; (count = input.read(bytes)) != -1; ) hash.update(bytes, 0, count);
    return HexFormat.of().formatHex(hash.digest());
  }

  void classpath(List<String> paths) throws Exception {
    Map<String, String> next = new LinkedHashMap<>();
    try {
      for (String raw : paths) {
        String path = Path.of(raw).toRealPath().toString();
        String hash;
        try (InputStream input = Files.newInputStream(Path.of(path))) {
          hash = digest(input);
        }
        Archive archive = archives.get(path);
        if (archive == null || !archive.digest.equals(hash)) {
          Map<String, String> classes = new LinkedHashMap<>();
          try (JarFile jar =
              new JarFile(Path.of(path).toFile(), false, JarFile.OPEN_READ, Runtime.version())) {
            for (var entry :
                jar.versionedStream()
                    .filter(
                        entry ->
                            entry.getName().endsWith(".class")
                                && !entry.getName().startsWith("META-INF/"))
                    .toList())
              try (InputStream input = jar.getInputStream(entry)) {
                classes.put(
                    entry.getName().substring(0, entry.getName().length() - 6).replace('/', '.'),
                    digest(input));
              }
          }
          archive = new Archive(hash, classes);
          archives.put(path, archive);
        }
        archive.classes.forEach(next::putIfAbsent);
      }
      Set<String> names = new HashSet<>(externalTypes.keySet());
      names.addAll(next.keySet());
      for (String name : names)
        if (!Objects.equals(externalTypes.get(name), next.get(name))) {
          changedSymbols.add(name.replace('$', '.'));
          changedSymbols.addAll(List.of(name.substring(name.lastIndexOf('.') + 1).split("\\$")));
        }
      externalTypes = next;
      archives
          .keySet()
          .removeIf(
              path ->
                  !paths.stream()
                      .anyMatch(
                          raw -> Path.of(raw).toAbsolutePath().normalize().equals(Path.of(path))));
    } catch (java.util.zip.ZipException error) {
      fallback = "classpath_change_unknown";
    }
  }

  void completed(int count, int invalidated, long started) {
    reparsedFiles = count;
    invalidatedFiles = invalidated;
    lastFallback = fallback;
    if (count > 0 || !dirty.isEmpty()) indexBuilds++;
    analysisMilliseconds = (System.nanoTime() - started) / 1_000_000.0;
    dirty.clear();
    changedSymbols.clear();
    fallback = null;
  }

  JsonObject statistics(JsonObject result) {
    result.addProperty("analysisMilliseconds", analysisMilliseconds);
    result.addProperty("reparsedFiles", reparsedFiles);
    result.addProperty("invalidatedFiles", invalidatedFiles);
    result.addProperty("incremental", lastFallback == null);
    result.add("fullFallbackReason", AstFacts.object("value", lastFallback).get("value"));
    return result;
  }
}
