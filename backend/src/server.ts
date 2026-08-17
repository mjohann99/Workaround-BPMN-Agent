import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(
  new URL("../.env", import.meta.url)
);

try {
  loadEnvFile(envPath);

  console.log(
    "[workaround-check] Loaded environment from:",
    envPath
  );
} catch (error) {
  const code =
    (error as { code?: string }).code;

  if (code === "ENOENT") {
    console.error(
      "[workaround-check] .env file not found at:",
      envPath
    );
  } else {
    console.error(
      "[workaround-check] Failed to load .env:",
      error
    );
  }
}

async function startServer(): Promise<void> {
  console.log(
    "[workaround-check] Starting backend..."
  );

  const hasOpenAiKey =
    Boolean(
      process.env.OPENAI_API_KEY?.trim()
    );

  console.log(
    "[workaround-check] OpenAI configured:",
    hasOpenAiKey
  );

  if (!hasOpenAiKey) {
    console.error(
      "[workaround-check] OPENAI_API_KEY is missing."
    );

    console.error(
      `[workaround-check] Expected .env file: ${envPath}`
    );
  }

  const { app } =
    await import("./app.js");

  const port =
    Number(process.env.PORT ?? 3001);

  app.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "Workaround Check API",
      openAiConfigured: hasOpenAiKey
    });
  });

  app.listen(
    port,
    "127.0.0.1",
    () => {
      console.log(
        `[workaround-check] Backend listening on http://127.0.0.1:${port}`
      );
    }
  );
}

startServer().catch((error) => {
  console.error(
    "[workaround-check] BACKEND_START_FAILED"
  );

  console.error(error);

  process.exitCode = 1;
});