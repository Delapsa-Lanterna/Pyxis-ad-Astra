package com.delapsalanterna.pyxis.javaanalysis;

import java.util.Map;

/** Starts the workspace in a dedicated JVM, leaving bundle classes to Equinox. */
public final class Launcher {
  public static void main(String[] args) throws Exception {
    Class<?> starter = Class.forName("org.eclipse.core.runtime.adaptor.EclipseStarter");
    starter
        .getMethod("setInitialProperties", Map.class)
        .invoke(
            null,
            Map.of(
                "osgi.noShutdown",
                "false",
                "eclipse.application",
                "com.delapsalanterna.pyxis.javaanalysis.engine"));
    starter.getMethod("run", String[].class, Runnable.class).invoke(null, args, null);
  }
}
