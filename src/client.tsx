import React from "react";
import ReactDOM from "react-dom/client";
import { getRouter } from "./router";
import { startInstance } from "./start";

const router = getRouter();

startInstance.render(
  <router.RootRoute>
    <Router router={router} />
  </router.RootRoute>,
  document.getElementById("root")!
);

function Router({ router }: { router: ReturnType<typeof getRouter> }) {
  return <router.RouterProvider />;
}
