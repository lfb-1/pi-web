// Document-level KaTeX styles: registers the @font-face rules for the math fonts so they
// load reliably. The rendered `.katex` markup itself lives in the FormattedText shadow
// root, which imports the same stylesheet via `?inline` for layout there.
import "katex/dist/katex.min.css";
import "./components/PiWebApp";
