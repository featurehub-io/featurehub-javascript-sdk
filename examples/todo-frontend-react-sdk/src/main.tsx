import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";

// IMPORTANT - this strict mode is a DEVELOPMENT mode, it will force the components to load twice
// it is not how the application would normally work.

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
