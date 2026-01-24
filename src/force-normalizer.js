// Placeholder to keep prior imports harmless; also a single place to toggle flags.
if (String(process.env.ENABLE_AI_NORMALIZER || "1") !== "1") {
  // In this build, AI normalizer is effectively mandatory but no-op when no API key is set.
}
