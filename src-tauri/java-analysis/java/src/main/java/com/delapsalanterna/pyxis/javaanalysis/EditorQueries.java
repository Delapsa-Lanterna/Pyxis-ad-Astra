package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.*;
import java.util.*;
import org.eclipse.jdt.core.dom.*;

/** Editor projections use the same immutable semantic snapshot and impact index as analysis. */
final class EditorQueries {
  static JsonObject update(AnalysisProject project, Protocol.Request input) throws Exception {
    List<Protocol.FileChange> files = new ArrayList<>();
    for (var document : input.documents()) {
      String file = project.key(document.file());
      String source = document.source();
      if (source == null) {
        var unit = project.copies.get(file);
        if (unit == null)
          throw new Protocol.Failure("engine.source_unavailable", "Source unavailable", file, null);
        source = apply(unit.getSource(), document.edits());
      }
      String previous =
          document.previousFile() == null ? file : project.key(document.previousFile());
      files.add(
          new Protocol.FileChange(
              !previous.equals(file)
                  ? "move"
                  : project.resources.containsKey(file) ? "replace" : "add",
              previous,
              file,
              source,
              document.version()));
    }
    return project.update(input.expectedRevision(), files);
  }

  static String apply(String source, List<Protocol.TextEdit> edits) {
    StringBuilder result = new StringBuilder();
    int offset = 0;
    for (var edit : edits) {
      if (edit.from() < offset || edit.to() < edit.from() || edit.to() > source.length())
        throw new Protocol.Failure(
            "engine.invalid_edit", "Invalid source edit range", null, edit.from());
      result.append(source, offset, edit.from()).append(edit.text());
      offset = edit.to();
    }
    return result.append(source, offset, source.length()).toString();
  }

  static JsonObject inspect(AnalysisProject project, Protocol.Request input) throws Exception {
    if (input.revision() != project.revision)
      throw new Protocol.Failure(
          "engine.stale_project", "Project revision is stale", input.file(), input.offset());
    var binary = project.binaries.documents.get(input.file());
    if (binary == null && input.file().startsWith("jar:"))
      throw new Protocol.Failure(
          "engine.source_unavailable",
          "Archive source is outside the current project snapshot",
          input.file(),
          null);
    String file = binary == null ? project.key(input.file()) : binary.file();
    var copy = project.copies.get(file);
    if (copy == null && binary == null)
      throw new Protocol.Failure(
          "engine.source_unavailable", "File is outside active sources", file, input.offset());
    JsonObject result =
        AstFacts.object(
            "purpose",
            input.purpose(),
            "revision",
            project.revision,
            "file",
            file,
            "version",
            binary == null ? project.versions.get(file) : 1L);
    if (binary != null) {
      result.addProperty("origin", binary.origin());
      result.addProperty("archiveKind", binary.kind());
    }
    if (input.purpose().equals("source")) {
      result.addProperty("source", binary == null ? copy.getSource() : binary.text());
      return result;
    }
    project.analyze();
    CompilationUnit unit =
        binary == null ? project.asts.get(file) : project.binaries.unit(project, binary);
    if (binary != null && input.purpose().equals("document")) {
      result.add("outline", outline(unit));
      return result;
    }
    if (input.purpose().equals("document")) {
      JsonObject summary = project.summaries.get(file);
      JsonArray diagnostics = summary.getAsJsonArray("diagnostics");
      for (var diagnostic : diagnostics) {
        diagnostic.getAsJsonObject().addProperty("file", file);
        diagnostic.getAsJsonObject().addProperty("version", project.versions.get(file));
      }
      result.add("diagnostics", diagnostics);
      result.add("outline", summary.getAsJsonArray("outline"));
      return result;
    }
    if (!List.of("hover", "declaration", "references").contains(input.purpose()))
      throw new IllegalArgumentException("Unknown editor query purpose");
    int length = binary == null ? copy.getBuffer().getLength() : binary.text().length();
    if (length == 0) return result;
    if (input.offset() < 0 || input.offset() > length)
      throw new IllegalArgumentException("Offset is outside source");
    ASTNode selected = NodeFinder.perform(unit, Math.min(input.offset(), length - 1), 0);
    Protocol.SemanticNode facts =
        binary == null ? project.semanticNodes.get(file).get(selected) : null;
    if (facts == null)
      facts =
          new SemanticSnapshot().node(selected, binary == null ? copy.getSource() : binary.text());
    var binding = facts.binding() == null ? facts.type() : facts.binding();
    if (binding == null) return result;
    result.add("binding", Protocol.JSON.toJsonTree(binding));
    IBinding resolved = AstFacts.binding(selected);
    if (resolved != null && resolved.getJavaElement() != null)
      result.addProperty("origin", resolved.getJavaElement().getPath().toOSString());
    if (!input.purpose().equals("hover")) {
      JsonArray locations = new JsonArray();
      for (JsonObject location : project.impact.locations(binding.key()))
        if (location.get("declaration").getAsBoolean() == input.purpose().equals("declaration"))
          locations.add(location);
      if (locations.isEmpty() && input.purpose().equals("declaration")) {
        JsonObject target =
            binary == null ? null : BinarySources.location(binary, unit, binding.key());
        if (target == null) target = project.binaries.declaration(project, resolved);
        if (target != null) locations.add(target);
      }
      result.add("locations", locations);
    }
    return result;
  }

  static JsonArray outline(CompilationUnit unit) {
    JsonArray outline = new JsonArray();
    unit.accept(
        new ASTVisitor() {
          @Override
          public void preVisit(ASTNode node) {
            SimpleName name =
                node instanceof AbstractTypeDeclaration type
                    ? type.getName()
                    : node instanceof MethodDeclaration method ? method.getName() : null;
            if (name == null) return;
            int depth = 0;
            for (ASTNode parent = node.getParent(); parent != null; parent = parent.getParent())
              if (parent instanceof AbstractTypeDeclaration || parent instanceof MethodDeclaration)
                depth++;
            outline.add(
                AstFacts.object(
                    "name",
                    name.getIdentifier(),
                    "kind",
                    node.getClass().getSimpleName(),
                    "depth",
                    depth,
                    "range",
                    AstFacts.range(name)));
          }
        });
    return outline;
  }

  private EditorQueries() {}
}
