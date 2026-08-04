import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, AppError } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

try {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  root.render(<AppError error={error} />);
}
