package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.eclipse.jdt.core.compiler.IProblem;
import org.eclipse.jdt.core.dom.*;

/** Projects public JDT syntax and binding facts without changing compiler decisions. */
public final class AstFacts {
  private AstFacts() {}

  static JsonObject object(Object... pairs) {
    JsonObject result = new JsonObject();
    for (int i = 0; i < pairs.length; i += 2) {
      Object value = pairs[i + 1];
      String key = (String) pairs[i];
      if (value == null) result.add(key, JsonNull.INSTANCE);
      else if (value instanceof JsonElement element) result.add(key, element);
      else if (value instanceof Number number) result.addProperty(key, number);
      else if (value instanceof Boolean bool) result.addProperty(key, bool);
      else result.addProperty(key, value.toString());
    }
    return result;
  }

  static JsonObject range(ASTNode node) {
    return object(
        "start", node.getStartPosition(), "end", node.getStartPosition() + node.getLength());
  }

  static JsonObject diagnostics(CompilationUnit unit) {
    JsonArray problems = new JsonArray();
    int errors = 0;
    for (IProblem problem : unit.getProblems()) {
      if (problem.isError()) errors++;
      problems.add(
          object(
              "id",
              problem.getID(),
              "message",
              problem.getMessage(),
              "severity",
              problem.isError() ? "error" : "warning",
              "start",
              problem.getSourceStart(),
              "end",
              problem.getSourceEnd() + 1,
              "line",
              problem.getSourceLineNumber()));
    }
    return object("errors", errors, "diagnostics", problems);
  }

  static IBinding binding(ASTNode node) {
    if (node instanceof Name name) return name.resolveBinding();
    if (node instanceof MethodInvocation call) return call.resolveMethodBinding();
    if (node instanceof SuperMethodInvocation call) return call.resolveMethodBinding();
    if (node instanceof ClassInstanceCreation call) return call.resolveConstructorBinding();
    if (node instanceof ConstructorInvocation call) return call.resolveConstructorBinding();
    if (node instanceof SuperConstructorInvocation call) return call.resolveConstructorBinding();
    if (node instanceof EnumConstantDeclaration call) return call.resolveConstructorBinding();
    if (node instanceof MethodReference reference) return reference.resolveMethodBinding();
    if (node instanceof MethodDeclaration declaration) return declaration.resolveBinding();
    if (node instanceof AbstractTypeDeclaration declaration) return declaration.resolveBinding();
    if (node instanceof VariableDeclaration declaration) return declaration.resolveBinding();
    if (node instanceof Type type) return type.resolveBinding();
    return null;
  }

  static IBinding declaration(IBinding binding) {
    if (binding instanceof IMethodBinding method) return method.getMethodDeclaration();
    if (binding instanceof IVariableBinding variable) return variable.getVariableDeclaration();
    if (binding instanceof ITypeBinding type) return type.getTypeDeclaration();
    return binding;
  }

  static boolean qualified(SimpleName name) {
    return name.getParent() instanceof QualifiedName qualified && qualified.getName() == name
        || name.getParent() instanceof FieldAccess field && field.getName() == name
        || name.getParent() instanceof SuperFieldAccess field && field.getName() == name;
  }

  static String callGroup(ASTNode node) {
    if (node instanceof MethodInvocation
        || node instanceof SuperMethodInvocation
        || node instanceof ConstructorInvocation
        || node instanceof SuperConstructorInvocation) return "method";
    if (node instanceof ClassInstanceCreation) return "constructor";
    if (node instanceof EnumConstantDeclaration constant && !constant.arguments().isEmpty())
      return "enumConstructor";
    if (node instanceof MethodReference) return "methodReference";
    return null;
  }

  static List<?> arguments(ASTNode node) {
    if (node instanceof MethodInvocation call) return call.arguments();
    if (node instanceof SuperMethodInvocation call) return call.arguments();
    if (node instanceof ClassInstanceCreation call) return call.arguments();
    if (node instanceof ConstructorInvocation call) return call.arguments();
    if (node instanceof SuperConstructorInvocation call) return call.arguments();
    if (node instanceof EnumConstantDeclaration call) return call.arguments();
    return List.of();
  }

  static JsonObject syntax(String source, String language) {
    CompilationUnit unit = ImpactIndex.syntax(source, language);
    JsonArray nodes = new JsonArray();
    Map<ASTNode, Integer> identities = new IdentityHashMap<>();
    unit.accept(
        new ASTVisitor() {
          @Override
          public void preVisit(ASTNode current) {
            JsonObject entry = range(current);
            entry.addProperty("id", nodes.size());
            identities.put(current, nodes.size());
            entry.addProperty("kind", current.getClass().getSimpleName());
            entry.addProperty("parent", identities.getOrDefault(current.getParent(), -1));
            nodes.add(entry);
          }
        });
    JsonArray comments = new JsonArray();
    for (Object comment : unit.getCommentList()) comments.add(range((ASTNode) comment));
    JsonObject result = diagnostics(unit);
    result.add("nodes", nodes);
    result.add("comments", comments);
    return result;
  }

  static JsonObject summarize(Map<String, CompilationUnit> units) {
    Map<String, Integer> counts = new TreeMap<>();
    JsonArray diagnostics = new JsonArray();
    JsonArray failures = new JsonArray();
    for (var file : units.entrySet()) {
      JsonObject problems = diagnostics(file.getValue());
      counts.merge("errors", problems.get("errors").getAsInt(), Integer::sum);
      for (JsonElement problem : problems.getAsJsonArray("diagnostics")) {
        problem.getAsJsonObject().addProperty("file", file.getKey());
        diagnostics.add(problem);
      }
      file.getValue()
          .accept(
              new ASTVisitor() {
                @Override
                public void preVisit(ASTNode current) {
                  if (current.getStartPosition() < 0 || current.getLength() <= 0) return;
                  String group = callGroup(current);
                  if (group == null) return;
                  counts.merge(group, 1, Integer::sum);
                  IBinding target = binding(current);
                  if (target != null && !target.isRecovered())
                    counts.merge(group + "Resolved", 1, Integer::sum);
                  else {
                    counts.merge(target == null ? "unresolved" : "recovered", 1, Integer::sum);
                    failures.add(
                        object(
                            "file",
                            file.getKey(),
                            "range",
                            range(current),
                            "kind",
                            current.getClass().getSimpleName()));
                  }
                }
              });
    }
    JsonObject summary =
        object("files", units.size(), "diagnostics", diagnostics, "bindingFailures", failures);
    counts.forEach(summary::addProperty);
    return summary;
  }
}
