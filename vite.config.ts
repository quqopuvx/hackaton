import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { handleApi } from "./server/handler.ts";
import { loadLocalEnv } from "./server/env.ts";

loadLocalEnv();

const apiPlugin: Plugin = {
  name: "hackathon-api",
  configureServer(server) {
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
});
