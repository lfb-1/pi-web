// Document-level KaTeX styles: registers the @font-face rules for the math fonts so they
// load reliably. The rendered `.katex` markup itself lives in the FormattedText shadow
// root, which imports the same stylesheet via `?inline` for layout there.
import "katex/dist/katex.min.css";
import "./components/PiWebApp";
import { initializeLocalization, localizationPolicyFromConfig } from "./localization/browser.js";
import { configApi } from "./api.js";

// Defaults belong to the gateway, not whichever machine/workspace is selected.
// Browser-local preferences remain usable while the request is pending or fails.
const config = configApi.config().catch((cause: unknown) => {
  console.warn("[i18n] Could not load gateway localization defaults; using browser preferences", cause);
  return undefined;
});
void initializeLocalization(undefined, window, undefined,
  config.then((response) => response?.effectiveConfig.defaultLocalization),
  config.then((response) => response === undefined ? {} : localizationPolicyFromConfig(response)),
).catch((cause: unknown) => {
  console.error("[i18n] Localization startup failed", cause);
});
