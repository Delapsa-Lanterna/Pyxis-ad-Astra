package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.ToNumberPolicy;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.equinox.app.IApplication;
import org.eclipse.equinox.app.IApplicationContext;

/** Owns the request lifetime and releases workspace state before Equinox shutdown. */
public final class AnalysisApplication implements IApplication {
  private final Map<String, AnalysisProject> projects = new LinkedHashMap<>();
  private int sequence;

  @Override
  public Object start(IApplicationContext context) throws Exception {
    ResourcesPlugin.getWorkspace().getDescription();
    Gson gson =
        new GsonBuilder()
            .serializeNulls()
            .disableHtmlEscaping()
            .setObjectToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE)
            .create();
    try (BufferedReader input =
            new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintWriter output = new PrintWriter(System.out, true, StandardCharsets.UTF_8)) {
      for (String line; (line = input.readLine()) != null; ) {
        JsonElement requestId = null;
        Protocol.Request typed = null;
        try {
          typed = gson.fromJson(line, Protocol.Request.class);
          requestId = typed.id();
          output.println(
              gson.toJson(
                  Protocol.encode(
                      new Protocol.Response(
                          requestId, Protocol.result(typed.op(), dispatch(typed), gson), null))));
          if (typed.op().equals("shutdown")) break;
        } catch (Exception error) {
          Protocol.Error details =
              new Protocol.Error(
                  error instanceof Protocol.Failure failure
                      ? failure.code
                      : "engine.request_failed",
                  error.getClass().getName(),
                  error.getMessage(),
                  typed == null ? null : typed.project(),
                  error instanceof Protocol.Failure failure
                      ? failure.file
                      : typed == null ? null : typed.file(),
                  error instanceof Protocol.Failure failure
                      ? failure.offset
                      : typed == null ? null : typed.offset());
          output.println(
              gson.toJson(Protocol.encode(new Protocol.Response(requestId, null, details))));
          error.printStackTrace(System.err);
        }
      }
    } finally {
      for (AnalysisProject project : projects.values()) project.close();
      projects.clear();
    }
    return EXIT_OK;
  }

  private JsonObject dispatch(Protocol.Request typed) throws Exception {
    String operation = typed.op();
    if (operation.equals("hello"))
      return AstFacts.object(
          "protocol",
          2,
          "engine",
          "1.0.0",
          "java",
          Runtime.version().feature(),
          "workspace",
          ResourcesPlugin.getWorkspace().getRoot().getLocation().toOSString(),
          "pid",
          ProcessHandle.current().pid());
    if (operation.equals("shutdown")) return AstFacts.object("closing", true);
    if (operation.equals("parse")) {
      JsonObject result =
          AstFacts.syntax(typed.source(), typed.language() == null ? "17" : typed.language());
      result.addProperty("version", typed.version());
      return result;
    }
    String id = typed.project();
    if (operation.equals("open")) {
      if (projects.containsKey(id))
        throw new IllegalArgumentException("Project already exists: " + id);
      AnalysisProject project = new AnalysisProject("analysis" + ++sequence, typed);
      projects.put(id, project);
      JsonObject result = project.identity();
      result.addProperty("project", id);
      return result;
    }
    AnalysisProject project = projects.get(id);
    if (project == null) throw new IllegalArgumentException("Unknown project: " + id);
    JsonObject result =
        switch (operation) {
          case "analyze" -> project.summary();
          case "update" -> project.update(typed);
          case "configure" -> project.configure(typed);
          case "query" -> project.query(typed);
          case "close" -> {
            project.close();
            projects.remove(id);
            yield AstFacts.object("released", true);
          }
          default -> throw new IllegalArgumentException("Unknown operation: " + operation);
        };
    result.addProperty("project", id);
    return result;
  }

  @Override
  public void stop() {}
}
