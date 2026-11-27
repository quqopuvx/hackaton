import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { handleApi } from "./server/handler.ts";
import { loadLocalEnv } from "./server/env.ts";
import { startApplicantMailScheduler } from "./server/applicant-mail.ts";

loadLocalEnv();

const apiPlugin: Plugin = {
  name: "hackathon-api",
  configureServer(server) {
    if (server.httpServer) server.httpServer.once("close", startApplicantMailScheduler());
    server.middlewares.use((req, res, next) => {
      void handleApi(req, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch((error: unknown) => {
          console.error(error);
          next();
        });
    });
  },
  configurePreviewServer(server) {
    server.httpServer.once("close", startApplicantMailScheduler());
    server.middlewares.use((req, res, next) => {
      void handleApi(req, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch((error: unknown) => {
          console.error(error);
          next();
        });
    });
  },
};

export default defineConfig({
  plugins: [vue(), tailwindcss(), apiPlugin],
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        olympiad: fileURLToPath(new URL("./olympiad/index.html", import.meta.url)),
      },
    },
  },
});
