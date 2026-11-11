package com.delapsalanterna.pyxis.javaanalysis;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/** Shares the version declaration filtered into the host by its build. */
final class Versions {
  private static final Properties VALUES = load();
  static final String ENGINE = VALUES.getProperty("engine");
  static final int PROTOCOL = Integer.parseInt(VALUES.getProperty("protocol"));
  static final String LANGUAGE = VALUES.getProperty("language");

  private static Properties load() {
    Properties values = new Properties();
    try (InputStream input = Versions.class.getResourceAsStream("/versions.properties")) {
      values.load(input);
      return values;
    } catch (IOException error) {
      throw new ExceptionInInitializerError(error);
    }
  }

  private Versions() {}
}
