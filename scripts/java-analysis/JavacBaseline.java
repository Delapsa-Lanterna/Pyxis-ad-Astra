import com.sun.source.tree.*;
import com.sun.source.util.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.tools.*;

/** Supplies independent compiler binding counts for the same frozen source inputs. */
public class JavacBaseline {
  public static void main(String[] args) throws Exception {
    List<Path> files = new ArrayList<>();
    for (String raw : args[0].split(java.io.File.pathSeparator))
      try (var entries = Files.walk(Path.of(raw))) {
        files.addAll(entries.filter(path -> path.toString().endsWith(".java")).sorted().toList());
      }
    var compiler = ToolProvider.getSystemJavaCompiler();
    var diagnostics = new DiagnosticCollector<JavaFileObject>();
    Map<String, Integer> counts = new TreeMap<>();
    try (var manager =
        compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
      var task =
          (JavacTask)
              compiler.getTask(
                  null,
                  manager,
                  diagnostics,
                  List.of("--release", "17", "-proc:none", "-classpath", args[1]),
                  null,
                  manager.getJavaFileObjectsFromPaths(files));
      var units = task.parse();
      task.analyze();
      var trees = Trees.instance(task);
      for (var unit : units)
        new TreePathScanner<Void, Void>() {
          void inspect(Tree node, String kind) {
            long start = trees.getSourcePositions().getStartPosition(unit, node);
            long end = trees.getSourcePositions().getEndPosition(unit, node);
            if (start < 0 || end <= start) return;
            if (kind.equals("constructor")) {
              var parent = trees.getElement(getCurrentPath().getParentPath());
              if (parent != null && parent.getKind() == ElementKind.ENUM_CONSTANT)
                kind = "enumConstructor";
            }
            counts.merge(kind, 1, Integer::sum);
            if (trees.getElement(getCurrentPath()) instanceof ExecutableElement)
              counts.merge(kind + "Resolved", 1, Integer::sum);
          }

          @Override
          public Void visitMethodInvocation(MethodInvocationTree node, Void unused) {
            inspect(node, "method");
            return super.visitMethodInvocation(node, unused);
          }

          @Override
          public Void visitNewClass(NewClassTree node, Void unused) {
            inspect(node, "constructor");
            return super.visitNewClass(node, unused);
          }

          @Override
          public Void visitMemberReference(MemberReferenceTree node, Void unused) {
            inspect(node, "methodReference");
            return super.visitMemberReference(node, unused);
          }
        }.scan(unit, null);
    }
    counts.put("files", files.size());
    counts.put(
        "errors",
        (int)
            diagnostics.getDiagnostics().stream()
                .filter(d -> d.getKind() == Diagnostic.Kind.ERROR)
                .count());
    for (var diagnostic : diagnostics.getDiagnostics())
      if (diagnostic.getKind() == Diagnostic.Kind.ERROR) System.err.println(diagnostic);
    System.out.print("{");
    boolean separator = false;
    for (var entry : counts.entrySet()) {
      if (separator) System.out.print(",");
      System.out.print("\"" + entry.getKey() + "\":" + entry.getValue());
      separator = true;
    }
    System.out.println("}");
  }
}
