import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, AppError } from "./App";
import { DocumentViewerRoute } from "./DocumentViewer";
import { PwaStatus } from "./pwa";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

try {
  const documentRoute = window.location.pathname.startsWith("/documents/");
  root.render(
    <StrictMode>
      <PwaStatus>
        {documentRoute
          ? <DocumentViewerRoute />
          : <App />}
      </PwaStatus>
    </StrictMode>,
  );
} catch (error) {
  root.render(<AppError error={error} />);
}
