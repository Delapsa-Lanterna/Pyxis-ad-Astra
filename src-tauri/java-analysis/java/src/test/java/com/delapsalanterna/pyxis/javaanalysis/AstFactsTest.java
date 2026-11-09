package com.delapsalanterna.pyxis.javaanalysis;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

class AstFactsTest {
  @Test
  void typedProtocolPreservesIdentityAndExclusiveResponseFields() {
    Gson gson = new Gson();
    Protocol.Request request =
        gson.fromJson(
            "{\"id\":41,\"op\":\"update\",\"project\":\"orbit\",\"expectedRevision\":2,\"files\":[{\"action\":\"delete\",\"file\":\"Orbit.java\",\"version\":3}]}",
            Protocol.Request.class);
    assertEquals(2, request.expectedRevision());
    assertEquals("delete", request.files().get(0).action());
    JsonObject success =
        Protocol.encode(
            new Protocol.Response(
                request.id(), new Protocol.ProjectSnapshot("orbit", 3, 0, 1), null));
    assertEquals(41, success.get("id").getAsInt());
    assertFalse(success.has("error"));
    JsonObject failure =
        Protocol.encode(
            new Protocol.Response(
                request.id(),
                null,
                new Protocol.Error(
                    "engine.stale_document",
                    "java.lang.IllegalArgumentException",
                    "Document version must increase",
                    "orbit",
                    "Orbit.java",
                    7)));
    assertFalse(failure.has("result"));
    assertEquals("Orbit.java", failure.getAsJsonObject("error").get("file").getAsString());
  }

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
