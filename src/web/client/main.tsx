import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App, AppError } from "./App";
import { PwaStatus } from "./pwa";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const DocumentViewerRoute = lazy(async () => {
  const module = await import("./DocumentViewer");
  return { default: module.DocumentViewerRoute };
});

try {
  const documentRoute = window.location.pathname.startsWith("/documents/");
  root.render(
    <StrictMode>
      <PwaStatus>
        {documentRoute
          ? <Suspense fallback={<main className="document-viewer"><p className="document-viewer-status">Loading document…</p></main>}>
              <DocumentViewerRoute />
            </Suspense>
          : <App />}
      </PwaStatus>
    </StrictMode>,
  );
} catch (error) {
  root.render(<AppError error={error} />);
}
