import { defineConfig } from "@hey-api/openapi-ts";
export default defineConfig({
  input: "../openapi.json",
  output: "generated",
  plugins: [
    "@hey-api/typescript",
    "@hey-api/client-fetch",
    "zod",
    { name: "@hey-api/sdk", validator: true },
  ],
});
