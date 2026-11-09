package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
    Gson gson = new GsonBuilder().serializeNulls().disableHtmlEscaping().create();
    try (BufferedReader input =
            new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintWriter output = new PrintWriter(System.out, true, StandardCharsets.UTF_8)) {
      for (String line; (line = input.readLine()) != null; ) {
        JsonObject response = new JsonObject();
        try {
          JsonObject request = JsonParser.parseString(line).getAsJsonObject();
          response.add("id", request.get("id"));
          response.add("result", dispatch(request));
          output.println(gson.toJson(response));
          if (request.get("op").getAsString().equals("shutdown")) break;
        } catch (Exception error) {
          response.add(
              "error",
              AstFacts.object(
                  "code",
                  "engine.request_failed",
                  "type",
                  error.getClass().getName(),
                  "message",
                  error.getMessage()));
          output.println(gson.toJson(response));
          error.printStackTrace(System.err);
        }
      }
    } finally {
      for (AnalysisProject project : projects.values()) project.close();
      projects.clear();
    }
    return EXIT_OK;
  }

  private JsonObject dispatch(JsonObject request) throws Exception {
    String operation = request.get("op").getAsString();
    if (operation.equals("hello"))
      return AstFacts.object(
          "protocol",
          1,
          "engine",
          "1.0.0",
          "java",
          Runtime.version().feature(),
          "workspace",
          ResourcesPlugin.getWorkspace().getRoot().getLocation().toOSString());
    if (operation.equals("shutdown")) return AstFacts.object("closing", true);
    if (operation.equals("parse")) {
      JsonObject result =
          AstFacts.syntax(
              request.get("source").getAsString(),
              request.has("language") ? request.get("language").getAsString() : "17");
      result.add("version", request.get("version"));
      return result;
    }
    String id = request.get("project").getAsString();
    if (operation.equals("open")) {
      if (projects.containsKey(id))
        throw new IllegalArgumentException("Project already exists: " + id);
      AnalysisProject project = new AnalysisProject("analysis" + ++sequence, request);
      projects.put(id, project);
      return project.identity();
    }
    AnalysisProject project = projects.get(id);
    if (project == null) throw new IllegalArgumentException("Unknown project: " + id);
    return switch (operation) {
      case "analyze" -> project.summary();
      case "update" -> project.update(request);
      case "query" -> project.query(request);
      case "close" -> {
        project.close();
        projects.remove(id);
        yield AstFacts.object("released", true);
      }
      default -> throw new IllegalArgumentException("Unknown operation: " + operation);
    };
  }

  @Override
  public void stop() {}
}
