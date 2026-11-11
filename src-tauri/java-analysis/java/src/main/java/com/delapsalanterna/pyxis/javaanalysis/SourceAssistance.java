package com.delapsalanterna.pyxis.javaanalysis;

import com.google.gson.*;
import java.util.*;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;

/** Completion and edit plans share the project's current unsaved source snapshot. */
final class SourceAssistance {
  static JsonObject query(AnalysisProject project, Protocol.Request request) throws Exception {
    if (request.revision() != project.revision)
      throw new Protocol.Failure(
          "engine.stale_project", "Project revision is stale", request.file(), request.offset());
    String file = project.key(request.file());
    ICompilationUnit unit = project.copies.get(file);
    if (unit == null)
      throw new Protocol.Failure(
          "engine.source_unavailable", "Source unavailable", file, request.offset());
    JsonObject result =
        AstFacts.object(
            "assistance",
            true,
            "purpose",
            request.purpose(),
            "revision",
            project.revision,
            "file",
            file,
            "version",
            project.versions.get(file));
    if (request.purpose().equals("validate")) return result;
    if (List.of("complete", "signature").contains(request.purpose())) {
      int offset = request.offset();
      String signatureName = null;
      if (offset < 0 || offset > unit.getBuffer().getLength())
        throw new Protocol.Failure("engine.invalid_offset", "Offset outside source", file, offset);
      if (request.purpose().equals("signature")) {
        String source = unit.getSource();
        project.analyze();
        ASTNode node = NodeFinder.perform(project.asts.get(file), Math.max(0, offset - 1), 0);
        while (node != null
            && !(node instanceof MethodInvocation)
            && !(node instanceof ClassInstanceCreation)) node = node.getParent();
        if (node == null) return result;
        if (node instanceof MethodInvocation call) signatureName = call.getName().getIdentifier();
        else {
          Type type = ((ClassInstanceCreation) node).getType();
          ITypeBinding binding = type.resolveBinding();
          signatureName = binding == null ? type.toString() : binding.getErasure().getName();
        }
        List<?> arguments = AstFacts.arguments(node);
        int argument = 0;
        for (Object raw : arguments) {
          ASTNode expression = (ASTNode) raw;
          if (offset <= expression.getStartPosition() + expression.getLength()) break;
          argument++;
        }
        if (argument == arguments.size() && argument > 0) {
          ASTNode last = (ASTNode) arguments.get(argument - 1);
          if (!source.substring(last.getStartPosition() + last.getLength(), offset).contains(","))
            argument--;
        }
        result.addProperty("argument", argument);
        int start =
            node instanceof MethodInvocation call
                ? call.getName().getStartPosition() + call.getName().getLength()
                : ((ClassInstanceCreation) node).getType().getStartPosition()
                    + ((ClassInstanceCreation) node).getType().getLength();
        offset = source.indexOf('(', start) + 1;
      }
      JsonArray candidates = new JsonArray();
      boolean signature = request.purpose().equals("signature");
      String selectedName = signatureName;
      unit.codeComplete(
          offset,
          new CompletionRequestor() {
            @Override
            public void accept(CompletionProposal proposal) {
              if (proposal.getCompletion() == null || proposal.getName() == null) return;
              if (signature
                  && proposal.getKind() != CompletionProposal.METHOD_REF
                  && proposal.getKind() != CompletionProposal.CONSTRUCTOR_INVOCATION) return;
              String name = new String(proposal.getName()),
                  detail =
                      proposal.getSignature() == null
                          ? ""
                          : Signature.toString(new String(proposal.getSignature()));
              if (signature && !name.equals(selectedName)) return;
              candidates.add(
                  AstFacts.object(
                      "label",
                      name,
                      "text",
                      new String(proposal.getCompletion()),
                      "detail",
                      detail,
                      "from",
                      proposal.getReplaceStart(),
                      "to",
                      proposal.getReplaceEnd(),
                      "relevance",
                      proposal.getRelevance()));
            }
          },
          project.owner,
          null);
      result.add("candidates", candidates);
      return result;
    }
    project.analyze();
    return SourceRefactor.plan(project, request, file, result);
  }

  private SourceAssistance() {}
}
