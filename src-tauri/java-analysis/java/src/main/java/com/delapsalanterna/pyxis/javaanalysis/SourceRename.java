package com.delapsalanterna.pyxis.javaanalysis;

import java.nio.file.Path;
import java.util.*;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;

/** Plans binding-based symbol and file renames and checks dispatch conflicts. */
final class SourceRename {
  static void plan(
      AnalysisProject project,
      Protocol.Request request,
      String file,
      Map<String, List<Protocol.TextEdit>> edits,
      Map<String, String> moves,
      List<String> conflicts)
      throws Exception {
    String next = request.name();
    if (next == null
        || !JavaConventions.validateIdentifier(next, project.language, project.language).isOK())
      throw new Protocol.Failure(
          "engine.invalid_name", "Invalid Java identifier", file, request.offset());
    CompilationUnit unit = project.asts.get(file);
    ASTNode selected = NodeFinder.perform(unit, request.offset(), 0);
    IBinding target = AstFacts.binding(selected);
    if (target == null || target.isRecovered())
      throw new Protocol.Failure(
          "engine.binding_required",
          "A resolved source declaration is required",
          file,
          request.offset());
    target = AstFacts.declaration(target);
    if (target instanceof IMethodBinding constructor && constructor.isConstructor())
      target = constructor.getDeclaringClass().getTypeDeclaration();
    final IBinding binding = target;
    Set<String> keys = new HashSet<>(Set.of(target.getKey()));
    List<IMethodBinding> methods = new ArrayList<>();
    boolean declaration =
        project.impact.locations(target.getKey()).stream()
            .anyMatch(location -> location.get("declaration").getAsBoolean());
    if (!declaration)
      throw new Protocol.Failure(
          "engine.source_required", "Binary declarations are read-only", file, request.offset());
    ITypeBinding record =
        target instanceof IVariableBinding variable && variable.isRecordComponent()
            ? ancestor(selected, RecordDeclaration.class).resolveBinding()
            : null;
    if (record != null) {
      for (IVariableBinding field : record.getDeclaredFields())
        if (field.getName().equals(target.getName())) keys.add(field.getKey());
      for (IMethodBinding method : record.getDeclaredMethods())
        if (method.getName().equals(target.getName()) && method.getParameterTypes().length == 0)
          keys.add(method.getKey());
    }
    boolean[] competing = {false};
    if (target instanceof IMethodBinding method) {
      List<IMethodBinding> declarations = new ArrayList<>();
      methods.add(method);
      for (CompilationUnit ast : project.asts.values())
        ast.accept(
            new ASTVisitor() {
              @Override
              public boolean visit(MethodDeclaration node) {
                IMethodBinding candidate = node.resolveBinding();
                competing[0] |= node.getName().getIdentifier().equals(next);
                if (candidate != null) declarations.add(candidate.getMethodDeclaration());
                return true;
              }
            });
      boolean expanded;
      do {
        expanded = false;
        for (IMethodBinding candidate : declarations)
          if (methods.stream().noneMatch(known -> known.isEqualTo(candidate))
              && methods.stream()
                  .anyMatch(known -> candidate.overrides(known) || known.overrides(candidate))) {
            methods.add(candidate);
            expanded = true;
          }
      } while (expanded);
      for (IMethodBinding known : methods) {
        keys.add(known.getKey());
        for (ITypeBinding ancestor : ancestors(known.getDeclaringClass()))
          if (!ancestor.isFromSource())
            for (IMethodBinding external : ancestor.getDeclaredMethods())
              if (known.overrides(external)) conflicts.add("binary_override_contract");
      }
    }
    if (target instanceof IVariableBinding variable && variable.isField())
      for (IVariableBinding field : variable.getDeclaringClass().getDeclaredFields())
        if (field.getName().equals(next) && !field.isEqualTo(variable))
          conflicts.add("field_name_collision");
    if (target instanceof IVariableBinding variable && variable.isField())
      for (CompilationUnit ast : project.asts.values())
        ast.accept(
            new ASTVisitor() {
              @Override
              public boolean visit(VariableDeclarationFragment node) {
                IVariableBinding field = node.resolveBinding();
                if (field != null
                    && field.isField()
                    && field.getName().equals(next)
                    && !field.isEqualTo(variable)
                    && (field.getDeclaringClass().isSubTypeCompatible(variable.getDeclaringClass())
                        || variable
                            .getDeclaringClass()
                            .isSubTypeCompatible(field.getDeclaringClass())))
                  conflicts.add("inherited_field_collision");
                return true;
              }
            });
    if (target instanceof IVariableBinding variable
        && !variable.isField()
        && !variable.isRecordComponent()) {
      ASTNode scope = scope(selected);
      unit.accept(
          new ASTVisitor() {
            @Override
            public boolean visit(SimpleName name) {
              IBinding other = name.resolveBinding();
              if (name.isDeclaration()
                  && other instanceof IVariableBinding local
                  && !local.isField()
                  && !local.isEqualTo(variable)
                  && name.getIdentifier().equals(next)
                  && overlaps(scope, scope(name))) conflicts.add("local_name_collision");
              return true;
            }
          });
    }
    if (record != null)
      for (IVariableBinding field : record.getDeclaredFields())
        if (field.getName().equals(next) && !keys.contains(field.getKey()))
          conflicts.add("record_component_collision");
    for (IMethodBinding method : methods)
      for (IMethodBinding other : method.getDeclaringClass().getDeclaredMethods())
        if (other.getName().equals(next) && Arrays.equals(parameters(method), parameters(other)))
          conflicts.add("method_signature_collision");
    if (!conflicts.isEmpty()) return;
    final MethodDeclaration localScope = ancestor(selected, MethodDeclaration.class);
    for (var entry : project.asts.entrySet()) {
      List<Protocol.TextEdit> changes = new ArrayList<>();
      entry
          .getValue()
          .accept(
              new ASTVisitor(true) {
                @Override
                public boolean visit(SimpleName name) {
                  IBinding current = AstFacts.binding(name);
                  if (current == null) return true;
                  current = AstFacts.declaration(current);
                  String replacement = null;
                  if (keys.contains(current.getKey())) {
                    replacement = next;
                    if (current instanceof IVariableBinding variable
                        && variable.isField()
                        && !name.isDeclaration()
                        && !AstFacts.qualified(name)
                        && ancestor(name, Javadoc.class) == null)
                      replacement = fieldName(name, variable, next);
                  } else if (binding instanceof IVariableBinding variable
                      && !variable.isField()
                      && !variable.isRecordComponent()
                      && current instanceof IVariableBinding field
                      && field.isField()
                      && name.getIdentifier().equals(next)
                      && ancestor(name, MethodDeclaration.class) == localScope
                      && !AstFacts.qualified(name))
                    replacement = fieldName(name, field, field.getName());
                  if (replacement != null)
                    changes.add(
                        new Protocol.TextEdit(
                            name.getStartPosition(),
                            name.getStartPosition() + name.getLength(),
                            replacement));
                  return true;
                }

                @Override
                public boolean visit(MethodDeclaration node) {
                  if (binding instanceof ITypeBinding type
                      && node.isConstructor()
                      && node.resolveBinding() != null
                      && node.resolveBinding()
                          .getDeclaringClass()
                          .getTypeDeclaration()
                          .isEqualTo(type)) {
                    SimpleName name = node.getName();
                    changes.add(
                        new Protocol.TextEdit(
                            name.getStartPosition(),
                            name.getStartPosition() + name.getLength(),
                            next));
                  }
                  return true;
                }
              });
      if (!changes.isEmpty()) edits.put(entry.getKey(), changes);
      if (target instanceof ITypeBinding type
          && Path.of(entry.getKey()).getFileName().toString().equals(type.getName() + ".java")
          && keys.stream()
              .anyMatch(
                  key ->
                      project.impact.locations(key).stream()
                          .anyMatch(
                              location ->
                                  location.get("declaration").getAsBoolean()
                                      && location
                                          .get("file")
                                          .getAsString()
                                          .equals(entry.getKey())))) {
        String destination = Path.of(entry.getKey()).resolveSibling(next + ".java").toString();
        if (project.resources.containsKey(destination) && !destination.equals(entry.getKey()))
          conflicts.add("type_file_collision");
        else moves.put(entry.getKey(), destination);
      }
    }
    if (competing[0] && changesDispatch(project, edits, keys, next))
      conflicts.add("method_binding_changed");
  }

  private static boolean changesDispatch(
      AnalysisProject project,
      Map<String, List<Protocol.TextEdit>> edits,
      Set<String> keys,
      String next)
      throws Exception {
    Map<String, List<String>> expected = new HashMap<>();
    Map<ICompilationUnit, String> names = new HashMap<>();
    List<ICompilationUnit> copies = new ArrayList<>(), changed = new ArrayList<>();
    WorkingCopyOwner owner = new WorkingCopyOwner() {};
    boolean[] different = {false};
    try {
      for (var entry : project.copies.entrySet()) {
        ICompilationUnit copy =
            JavaCore.createCompilationUnitFrom(project.resources.get(entry.getKey()))
                .getWorkingCopy(owner, null);
        copies.add(copy);
        List<Protocol.TextEdit> ranges = edits.get(entry.getKey());
        if (ranges != null) ranges.sort(Comparator.comparingInt(Protocol.TextEdit::from));
        copy.getBuffer()
            .setContents(
                ranges == null
                    ? entry.getValue().getSource()
                    : EditorQueries.apply(entry.getValue().getSource(), ranges));
        names.put(copy, entry.getKey());
        if (ranges != null) {
          changed.add(copy);
          expected.put(entry.getKey(), calls(project.asts.get(entry.getKey()), keys, next));
        }
      }
      ASTParser parser = ASTParser.newParser(AST.getJLSLatest());
      parser.setProject(project.javaProject);
      parser.setWorkingCopyOwner(owner);
      parser.setResolveBindings(true);
      parser.createASTs(
          changed.toArray(ICompilationUnit[]::new),
          new String[0],
          new ASTRequestor() {
            @Override
            public void acceptAST(ICompilationUnit unit, CompilationUnit ast) {
              different[0] |= !expected.get(names.get(unit)).equals(calls(ast, Set.of(), next));
            }
          },
          null);
      return different[0];
    } finally {
      for (ICompilationUnit copy : copies) copy.discardWorkingCopy();
    }
  }

  private static List<String> calls(CompilationUnit ast, Set<String> keys, String next) {
    List<String> result = new ArrayList<>();
    ast.accept(
        new ASTVisitor() {
          @Override
          public void preVisit(ASTNode node) {
            if (AstFacts.callGroup(node) == null) return;
            IBinding binding = AstFacts.binding(node);
            if (!(binding instanceof IMethodBinding method)) {
              result.add("unresolved");
              return;
            }
            method = method.getMethodDeclaration();
            result.add(
                method.getDeclaringClass().getTypeDeclaration().getQualifiedName()
                    + "|"
                    + (keys.contains(method.getKey()) ? next : method.getName())
                    + Arrays.toString(parameters(method)));
          }
        });
    return result;
  }

  private static String[] parameters(IMethodBinding method) {
    return Arrays.stream(method.getParameterTypes())
        .map(type -> type.getErasure().getQualifiedName())
        .toArray(String[]::new);
  }

  private static List<ITypeBinding> ancestors(ITypeBinding type) {
    List<ITypeBinding> result = new ArrayList<>();
    ArrayDeque<ITypeBinding> pending = new ArrayDeque<>();
    if (type.getSuperclass() != null) pending.add(type.getSuperclass());
    pending.addAll(List.of(type.getInterfaces()));
    Set<String> visited = new HashSet<>();
    while (!pending.isEmpty()) {
      ITypeBinding found = pending.removeFirst();
      if (!visited.add(found.getKey())) continue;
      result.add(found);
      if (found.getSuperclass() != null) pending.add(found.getSuperclass());
      pending.addAll(List.of(found.getInterfaces()));
    }
    return result;
  }

  private static String fieldName(SimpleName name, IVariableBinding field, String next) {
    ITypeBinding owner = field.getDeclaringClass();
    if (Flags.isStatic(field.getModifiers())) return owner.getQualifiedName() + "." + next;
    for (ASTNode node = name.getParent(); node != null; node = node.getParent()) {
      ITypeBinding enclosing =
          node instanceof AbstractTypeDeclaration type
              ? type.resolveBinding()
              : node instanceof AnonymousClassDeclaration anonymous
                  ? anonymous.resolveBinding()
                  : null;
      if (enclosing != null)
        return (enclosing.isSubTypeCompatible(owner) ? "this." : owner.getName() + ".this.") + next;
    }
    throw new IllegalStateException("Field context unavailable");
  }

  private static <T extends ASTNode> T ancestor(ASTNode node, Class<T> type) {
    for (ASTNode current = node; current != null; current = current.getParent())
      if (type.isInstance(current)) return type.cast(current);
    return null;
  }

  private static ASTNode scope(ASTNode name) {
    for (ASTNode node = name.getParent(); node != null; node = node.getParent())
      if (node instanceof Block
          || node instanceof MethodDeclaration
          || node instanceof LambdaExpression
          || node instanceof CatchClause
          || node instanceof ForStatement
          || node instanceof EnhancedForStatement) return node;
    throw new IllegalStateException("Local scope unavailable");
  }

  private static boolean overlaps(ASTNode left, ASTNode right) {
    return left.getStartPosition() < right.getStartPosition() + right.getLength()
        && right.getStartPosition() < left.getStartPosition() + left.getLength();
  }

  private SourceRename() {}
}
