package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.List;

/** Typed Java representation of the versioned host protocol. */
final class Protocol {
  record Request(
      JsonElement id,
      String op,
      String project,
      String source,
      Long version,
      String language,
      List<String> sources,
      List<String> classpath,
      String javaHome,
      Long expectedRevision,
      List<FileChange> files,
      Long revision,
      String file,
      Integer offset,
      Boolean forceFull) {}

  record FileChange(String action, String file, String target, String source, Long version) {}

  record Response(JsonElement id, Object result, Error error) {}

  record Error(
      String code, String type, String message, String project, String file, Integer offset) {}

  record Handshake(int protocol, String engine, int java, String workspace, long pid) {}

  record SourceRange(int start, int end) {}

  record Diagnostic(
      int id,
      String message,
      String severity,
      int start,
      int end,
      int line,
      String file,
      Long version) {}

  record SyntaxNode(int id, int parent, String kind, int start, int end) {}

  record SyntaxResult(
      long version,
      int errors,
      List<Diagnostic> diagnostics,
      List<SyntaxNode> nodes,
      List<SourceRange> comments) {}

  record Binding(
      String key,
      String name,
      boolean recovered,
      int kind,
      int modifiers,
      String owner,
      String type,
      Boolean constructor,
      List<String> parameters,
      Object constant,
      Boolean binary,
      String superclass,
      List<String> interfaces) {}

  record Argument(int start, int end, String text, Binding binding) {}

  record SemanticNode(
      int start,
      int end,
      String kind,
      Binding binding,
      Binding type,
      Object constant,
      List<Argument> arguments) {}

  record SourceLocation(String file, long version, SourceRange range) {}

  record QueryResult(
      String project,
      long revision,
      long version,
      String file,
      SemanticNode node,
      SemanticNode call,
      List<SourceLocation> declarations,
      List<SourceLocation> references,
      double analysisMilliseconds,
      int reparsedFiles,
      int invalidatedFiles,
      boolean incremental,
      String fullFallbackReason) {}

  record ProjectSnapshot(String project, long revision, int files, int parseBatches) {}

  record BindingFailure(String file, SourceRange range, String kind) {}

  record AnalysisSummary(
      String project,
      long revision,
      int files,
      int errors,
      List<Diagnostic> diagnostics,
      List<BindingFailure> bindingFailures,
      int parseBatches,
      int referenceIndexBuilds,
      long heapUsedBytes,
      long heapCommittedBytes,
      int method,
      int methodResolved,
      int constructor,
      int constructorResolved,
      int enumConstructor,
      int enumConstructorResolved,
      int methodReference,
      int methodReferenceResolved,
      int unresolved,
      int recovered,
      double analysisMilliseconds,
      int reparsedFiles,
      int invalidatedFiles,
      boolean incremental,
      String fullFallbackReason) {}

  record ProjectRelease(String project, boolean released) {}

  record ShutdownResult(boolean closing) {}

  /** Facts are converted once at the JDT-to-protocol boundary. */
  static Object result(String operation, JsonObject facts, Gson gson) {
    Class<?> type =
        switch (operation) {
          case "hello" -> Handshake.class;
          case "parse" -> SyntaxResult.class;
          case "query" -> QueryResult.class;
          case "analyze" -> AnalysisSummary.class;
          case "close" -> ProjectRelease.class;
          case "shutdown" -> ShutdownResult.class;
          default -> ProjectSnapshot.class;
        };
    return gson.fromJson(facts, type);
  }

  static final class Failure extends IllegalArgumentException {
    final String code;
    final String file;
    final Integer offset;

    Failure(String code, String message, String file, Integer offset) {
      super(message);
      this.code = code;
      this.file = file;
      this.offset = offset;
    }
  }

  static JsonObject encode(Response response) {
    JsonObject json = new JsonObject();
    json.add("id", response.id());
    if (response.result() != null) json.add("result", new Gson().toJsonTree(response.result()));
    if (response.error() != null)
      json.add("error", new com.google.gson.Gson().toJsonTree(response.error()));
    return json;
  }

  private Protocol() {}
}
