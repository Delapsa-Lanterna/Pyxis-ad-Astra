import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.zip.ZipFile;

/** Verifies base class compatibility without executing third-party bytecode. */
public final class VerifyResources {
  public static void main(String[] args) throws Exception {
    int maximumAllowed = Integer.parseInt(args[0]) + 44;
    int classes = 0;
    int maximum = 0;
    int jars = 0;
    for (String directory : Arrays.copyOfRange(args, 1, args.length)) {
      List<Path> paths;
      try (var files = Files.list(Path.of(directory))) {
        paths = files.filter(path -> path.toString().endsWith(".jar")).sorted().toList();
      }
      for (Path path : paths) {
        jars++;
        try (var archive = new ZipFile(path.toFile())) {
          var entries = archive.entries();
          while (entries.hasMoreElements()) {
            var entry = entries.nextElement();
            if (!entry.getName().endsWith(".class")
                || entry.getName().startsWith("META-INF/versions/")) continue;
            try (var stream = archive.getInputStream(entry)) {
              byte[] header = stream.readNBytes(8);
              int major = (header[6] & 255) * 256 + (header[7] & 255);
              if (major > maximumAllowed)
                throw new IllegalStateException(path + ": " + entry.getName());
              maximum = Math.max(maximum, major);
              classes++;
            }
          }
        }
      }
    }
    System.out.println(
        "{\"jars\":" + jars + ",\"baseClasses\":" + classes + ",\"maxMajor\":" + maximum + "}");
  }
}
