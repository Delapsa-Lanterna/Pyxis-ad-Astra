package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.*;
import java.util.*;

/** Plans edits without modifying either the source directories or their working copies. */
final class SourceRefactor {
  static JsonObject plan(
      AnalysisProject project, Protocol.Request request, String file, JsonObject result)
      throws Exception {
    Map<String, List<Protocol.TextEdit>> edits = new LinkedHashMap<>();
    Map<String, String> moves = new HashMap<>();
    List<String> conflicts = new ArrayList<>();
    if (request.purpose().equals("imports"))
      SourceImports.plan(project, request, file, edits, result);
    else if (request.purpose().equals("rename"))
      SourceRename.plan(project, request, file, edits, moves, conflicts);
    else throw new IllegalArgumentException("Unknown source assistance purpose");
    JsonArray files = new JsonArray();
    if (conflicts.isEmpty() && !result.has("choices"))
      for (var entry : edits.entrySet()) {
        entry.getValue().sort(Comparator.comparingInt(Protocol.TextEdit::from));
        files.add(
            Protocol.JSON.toJsonTree(
                new Protocol.SourceEdit(
                    entry.getKey(),
                    project.versions.get(entry.getKey()),
                    project.copies.get(entry.getKey()).getSource(),
                    moves.get(entry.getKey()),
                    entry.getValue())));
      }
    result.add("files", files);
    result.add("conflicts", Protocol.JSON.toJsonTree(conflicts));
    return result;
  }

  private SourceRefactor() {}
}
