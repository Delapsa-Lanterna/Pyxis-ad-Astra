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

  static JsonArray strings(List<String> values) {
    JsonArray result = new JsonArray();
    values.forEach(result::add);
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

  static JsonElement describe(IBinding binding) {
    if (binding == null) return JsonNull.INSTANCE;
    JsonObject result =
        object(
            "key",
            declaration(binding).getKey(),
            "name",
            binding.getName(),
            "recovered",
            binding.isRecovered(),
            "kind",
            binding.getKind(),
            "modifiers",
            binding.getModifiers());
    if (binding instanceof IMethodBinding method) {
      result.addProperty("owner", method.getDeclaringClass().getQualifiedName());
      result.addProperty("type", method.getReturnType().getQualifiedName());
      result.addProperty("constructor", method.isConstructor());
      JsonArray parameters = new JsonArray();
      for (ITypeBinding parameter : method.getParameterTypes())
        parameters.add(parameter.getQualifiedName());
      result.add("parameters", parameters);
    } else if (binding instanceof IVariableBinding variable) {
      result.addProperty("type", variable.getType().getQualifiedName());
      Object constant = variable.getConstantValue();
      result.add("constant", object("value", constant).get("value"));
    } else if (binding instanceof ITypeBinding type) {
      result.addProperty("type", type.getQualifiedName());
      result.addProperty("binary", !type.isFromSource());
      result.add(
          "superclass",
          type.getSuperclass() == null
              ? JsonNull.INSTANCE
              : object("name", type.getSuperclass().getQualifiedName()).get("name"));
      JsonArray interfaces = new JsonArray();
      for (ITypeBinding entry : type.getInterfaces()) interfaces.add(entry.getQualifiedName());
      result.add("interfaces", interfaces);
    }
    return result;
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

  static JsonObject node(ASTNode node, String source) {
    JsonObject result = range(node);
    result.addProperty("kind", node.getClass().getSimpleName());
    result.add("binding", describe(binding(node)));
    if (node instanceof Expression expression) {
      result.add("type", describe(expression.resolveTypeBinding()));
      result.add(
          "constant", object("value", expression.resolveConstantExpressionValue()).get("value"));
    }
    JsonArray parameters = new JsonArray();
    for (Object argument : arguments(node)) {
      ASTNode argumentNode = (ASTNode) argument;
      JsonObject entry = range(argumentNode);
      entry.addProperty(
          "text",
          source.substring(
              argumentNode.getStartPosition(),
              argumentNode.getStartPosition() + argumentNode.getLength()));
      entry.add("binding", describe(binding(argumentNode)));
      parameters.add(entry);
    }
    result.add("arguments", parameters);
    return result;
  }

  static JsonObject syntax(String source, String language) {
    ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
    parser.setSource(source.toCharArray());
    parser.setCompilerOptions(AnalysisProject.options(language));
    parser.setStatementsRecovery(true);
    CompilationUnit unit = (CompilationUnit) parser.createAST(null);
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
