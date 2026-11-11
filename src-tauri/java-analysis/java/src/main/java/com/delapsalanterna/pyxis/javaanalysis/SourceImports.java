package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.*;
import java.util.*;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;
import org.eclipse.jdt.core.dom.rewrite.ImportRewrite;
import org.eclipse.jdt.core.search.*;
import org.eclipse.text.edits.*;

/** Builds import edits and explicit choices from the current bound source. */
final class SourceImports {
  static void plan(
      AnalysisProject project,
      Protocol.Request request,
      String file,
      Map<String, List<Protocol.TextEdit>> edits,
      JsonObject result)
      throws Exception {
    CompilationUnit ast = project.asts.get(file);
    ImportRewrite rewrite = ImportRewrite.create(ast, true);
    rewrite.setImportOrder(new String[] {"java", "javax", "org", "com"});
    rewrite.setOnDemandImportThreshold(99);
    rewrite.setStaticOnDemandImportThreshold(99);
    for (Object raw : ast.imports()) {
      ImportDeclaration item = (ImportDeclaration) raw;
      String name = item.getName().getFullyQualifiedName() + (item.isOnDemand() ? ".*" : "");
      if (item.isStatic()) rewrite.removeStaticImport(name);
      else rewrite.removeImport(name);
    }
    Set<String> types = new TreeSet<>();
    Map<String, Boolean> statics = new TreeMap<>();
    ast.accept(
        new ASTVisitor(true) {
          @Override
          public boolean visit(ImportDeclaration node) {
            return false;
          }

          @Override
          public boolean visit(PackageDeclaration node) {
            return false;
          }

          @Override
          public boolean visit(SimpleName name) {
            if (name.isDeclaration()) return true;
            IBinding binding = name.resolveBinding();
            if (binding instanceof ITypeBinding type
                && !type.isRecovered()
                && !type.isTypeVariable()
                && !type.isPrimitive()
                && !(name.getParent() instanceof QualifiedName))
              types.add(type.getTypeDeclaration().getQualifiedName());
            if ((name.getParent() instanceof SimpleType || name.getParent() instanceof Annotation)
                && (binding == null || binding.isRecovered()))
              types.add("?" + name.getIdentifier());
            if (binding instanceof IMethodBinding method
                && Flags.isStatic(method.getModifiers())
                && name.getParent() instanceof MethodInvocation invocation
                && invocation.getExpression() == null)
              statics.put(
                  method.getDeclaringClass().getQualifiedName() + "." + method.getName(), false);
            if (binding instanceof IVariableBinding field
                && field.isField()
                && Flags.isStatic(field.getModifiers())
                && !AstFacts.qualified(name))
              statics.put(
                  field.getDeclaringClass().getQualifiedName() + "." + field.getName(), true);
            return true;
          }
        });
    List<Protocol.ImportChoice> choices = new ArrayList<>();
    for (String type : types) {
      if (type.startsWith("?")) {
        String simple = type.substring(1);
        List<String> candidates = new ArrayList<>();
        new SearchEngine(project.owner)
            .searchAllTypeNames(
                null,
                SearchPattern.R_EXACT_MATCH,
                simple.toCharArray(),
                SearchPattern.R_EXACT_MATCH,
                IJavaSearchConstants.TYPE,
                SearchEngine.createJavaSearchScope(new IJavaElement[] {project.javaProject}),
                new TypeNameMatchRequestor() {
                  @Override
                  public void acceptTypeNameMatch(TypeNameMatch match) {
                    candidates.add(match.getFullyQualifiedName());
                  }
                },
                IJavaSearchConstants.WAIT_UNTIL_READY_TO_SEARCH,
                null);
        List<String> resolved = candidates.stream().distinct().sorted().toList();
        String selected = request.choices() == null ? null : request.choices().get(simple);
        if (resolved.size() == 1) selected = resolved.get(0);
        if (selected == null) {
          choices.add(new Protocol.ImportChoice(simple, resolved));
          continue;
        }
        if (!resolved.contains(selected))
          throw new Protocol.Failure(
              "engine.import_choice", "Import choice is outside candidates", file, null);
        type = selected;
      }
      rewrite.addImport(type);
    }
    if (!choices.isEmpty()) {
      result.add("choices", Protocol.JSON.toJsonTree(choices));
      return;
    }
    for (var entry : statics.entrySet()) {
      int separator = entry.getKey().lastIndexOf('.');
      rewrite.addStaticImport(
          entry.getKey().substring(0, separator),
          entry.getKey().substring(separator + 1),
          entry.getValue());
    }
    List<Protocol.TextEdit> ranges = new ArrayList<>();
    rewrite
        .rewriteImports(null)
        .accept(
            new TextEditVisitor() {
              @Override
              public boolean visit(InsertEdit edit) {
                ranges.add(
                    new Protocol.TextEdit(edit.getOffset(), edit.getOffset(), edit.getText()));
                return true;
              }

              @Override
              public boolean visit(ReplaceEdit edit) {
                ranges.add(
                    new Protocol.TextEdit(
                        edit.getOffset(), edit.getExclusiveEnd(), edit.getText()));
                return true;
              }

              @Override
              public boolean visit(DeleteEdit edit) {
                ranges.add(new Protocol.TextEdit(edit.getOffset(), edit.getExclusiveEnd(), ""));
                return true;
              }
            });
    if (!ranges.isEmpty()) edits.put(file, ranges);
  }

  private SourceImports() {}
}
