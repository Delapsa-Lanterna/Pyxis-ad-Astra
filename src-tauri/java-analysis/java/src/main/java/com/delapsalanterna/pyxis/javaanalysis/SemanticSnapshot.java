package com.delapsalanterna.pyxis.javaanalysis;

import java.util.*;
import org.eclipse.jdt.core.dom.*;

/** Compact immutable facts outlive JDT's compiler scopes without retaining mutable bindings. */
final class SemanticSnapshot {
  final Map<Protocol.Binding, Protocol.Binding> bindings = new HashMap<>();

  Protocol.Binding binding(IBinding value) {
    if (value == null) return null;
    String owner = null, type = null, superclass = null;
    Boolean constructor = null, binary = null;
    List<String> parameters = null, interfaces = null;
    Object constant = null;
    if (value instanceof IMethodBinding method) {
      owner = method.getDeclaringClass().getQualifiedName();
      type = method.getReturnType().getQualifiedName();
      constructor = method.isConstructor();
      parameters =
          Arrays.stream(method.getParameterTypes()).map(ITypeBinding::getQualifiedName).toList();
    } else if (value instanceof IVariableBinding variable) {
      type = variable.getType().getQualifiedName();
      constant = variable.getConstantValue();
      if (constant instanceof Character character) constant = character.toString();
    } else if (value instanceof ITypeBinding bound) {
      type = bound.getQualifiedName();
      binary = !bound.isFromSource();
      superclass = bound.getSuperclass() == null ? null : bound.getSuperclass().getQualifiedName();
      interfaces =
          Arrays.stream(bound.getInterfaces()).map(ITypeBinding::getQualifiedName).toList();
    }
    Protocol.Binding result =
        new Protocol.Binding(
            AstFacts.declaration(value).getKey(),
            value.getName(),
            value.isRecovered(),
            value.getKind(),
            value.getModifiers(),
            owner,
            type,
            constructor,
            parameters,
            constant,
            binary,
            superclass,
            interfaces);
    return bindings.computeIfAbsent(result, ignored -> result);
  }

  Protocol.SemanticNode node(ASTNode node, String source) {
    Protocol.Binding resolvedType = null;
    Object constant = null;
    if (node instanceof Expression expression) {
      resolvedType = binding(expression.resolveTypeBinding());
      constant = expression.resolveConstantExpressionValue();
      if (constant instanceof Character character) constant = character.toString();
    }
    List<Protocol.Argument> arguments = new ArrayList<>();
    for (Object raw : AstFacts.arguments(node)) {
      ASTNode argument = (ASTNode) raw;
      arguments.add(
          new Protocol.Argument(
              argument.getStartPosition(),
              argument.getStartPosition() + argument.getLength(),
              source.substring(
                  argument.getStartPosition(), argument.getStartPosition() + argument.getLength()),
              binding(AstFacts.binding(argument))));
    }
    return new Protocol.SemanticNode(
        node.getStartPosition(),
        node.getStartPosition() + node.getLength(),
        node.getClass().getSimpleName(),
        binding(AstFacts.binding(node)),
        resolvedType,
        constant,
        arguments);
  }
}
