package com.delapsalanterna.pyxis.javaanalysis;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.jar.JarFile;
import org.jetbrains.java.decompiler.main.Fernflower;
import org.jetbrains.java.decompiler.main.decompiler.ConsoleFileSaver;
import org.jetbrains.java.decompiler.main.extern.*;

/** Supplies just one compilation unit and its nested classes to Vineflower. */
final class ClassDecompiler implements IContextSource, IContextSource.IOutputSink {
  private final JarFile archive;
  private final String name;
  private final Entries entries;
  private String source;

  private ClassDecompiler(JarFile archive, String name, List<Entry> classes) {
    this.archive = archive;
    this.name = name;
    this.entries = new Entries(classes, List.of(), List.of());
  }

  static String source(JarFile archive, String name, ImpactIndex.Archive index) throws Exception {
    String qualified = name.replace('/', '.');
    var classes =
        index.classes().keySet().stream()
            .filter(type -> type.equals(qualified) || type.startsWith(qualified + "$"))
            .map(type -> Entry.atBase(type.replace('.', '/')))
            .toList();
    var unit = new ClassDecompiler(archive, name, classes);
    var engine =
        new Fernflower(
            new ConsoleFileSaver(null),
            Map.of("thread-count", "1", "hide-default-constructor", "0"),
            IFernflowerLogger.NO_OP);
    try {
      engine.addSource(unit);
      engine.decompileContext();
      if (unit.source == null)
        throw new Protocol.Failure(
            "engine.decompile_failed", "Class source unavailable", name, null);
      return unit.source;
    } finally {
      engine.clearContext();
    }
  }

  public String getName() {
    return name;
  }

  public Entries getEntries() {
    return entries;
  }

  public InputStream getInputStream(String path) throws IOException {
    var entry = archive.getJarEntry(path);
    return entry == null ? null : archive.getInputStream(entry);
  }

  public IOutputSink createOutputSink(IResultSaver saver) {
    return this;
  }

  public void begin() {}

  public void acceptDirectory(String path) {}

  public void acceptOther(String path) {}

  public void close() {}

  public void acceptClass(String qualifiedName, String fileName, String content, int[] mapping) {
    if (name.equals(qualifiedName)) source = content;
  }
}
