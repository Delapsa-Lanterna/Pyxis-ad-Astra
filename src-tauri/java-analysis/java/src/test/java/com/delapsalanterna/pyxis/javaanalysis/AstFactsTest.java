package com.delapsalanterna.pyxis.javaanalysis;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

class AstFactsTest {
  @Test
  void preservesUtf16OffsetsAndCommentsAcrossLineEndings() {
    for (String newline : new String[] {"\n", "\r\n"}) {
      String source = "// satellite 🪐" + newline + "class Orbit { String name = \"星\"; }";
      JsonObject result = AstFacts.syntax(source, "17");
      assertEquals(0, result.get("errors").getAsInt());
      assertEquals(1, result.getAsJsonArray("comments").size());
      boolean found = false;
      for (var raw : result.getAsJsonArray("nodes")) {
        JsonObject node = raw.getAsJsonObject();
        if (node.get("kind").getAsString().equals("TypeDeclaration")) {
          assertEquals(source.indexOf("class"), node.get("start").getAsInt());
          assertEquals(source.length(), node.get("end").getAsInt());
          found = true;
        }
      }
      assertTrue(found);
    }
  }

  @Test
  void reportsIncompleteSourceAndAcceptsJava17Structures() {
    assertTrue(AstFacts.syntax("class Orbit { void move( {", "17").get("errors").getAsInt() > 0);
    assertEquals(
        0,
        AstFacts.syntax(
                "record Orbit(int radius) { int speed(int n) { return switch(n) { case 1 -> radius;"
                    + " default -> 0; }; } }",
                "17")
            .get("errors")
            .getAsInt());
  }
}
