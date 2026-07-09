import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const monoSvgDir = path.join(root, "node_modules/mono-icons/svg");
const lucideSvgDir = path.join(root, "node_modules/lucide-static/icons");
const outPath = path.join(root, "components/ui/icons.tsx");

const GLYPHS = [
  "add",
  "arrow-left",
  "arrow-right",
  "bookmark",
  "check",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "circle-add",
  "circle-check",
  "circle-error",
  "circle-information",
  "circle-warning",
  "clock",
  "close",
  "comment",
  "copy",
  "credit-card",
  "document",
  "enter",
  "export",
  "external-link",
  "filter",
  "filter-alt",
  "grid",
  "heart",
  "inbox",
  "link",
  "log-out",
  "message",
  "message-alt",
  "notification",
  "refresh",
  "search",
  "send",
  "user",
  "user-check",
  "warning",
];

const LUCIDE_BRIDGE = [
  { file: "bookmark-check", exportName: "BookmarkCheckIcon" },
  { file: "check-check", exportName: "CheckDoubleIcon" },
  { file: "globe", exportName: "GlobeIcon" },
  { file: "reply", exportName: "ReplyIcon" },
  { file: "shield", exportName: "ShieldIcon" },
  { file: "shield-alert", exportName: "ShieldWarningIcon" },
  { file: "shield-check", exportName: "ShieldCheckIcon" },
  { file: "wallet", exportName: "WalletIcon" },
];

const GENERATED_START = "// GENERATED START";
const GENERATED_END = "// GENERATED END";

const LUCIDE_DROP_ATTRS = new Set([
  "stroke",
  "fill",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "class",
  "xmlns",
]);

function toComponentName(glyph) {
  return (
    glyph
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") + "Icon"
  );
}

function kebabToCamel(name) {
  return name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function parsePathAttributes(attrString) {
  const d = attrString.match(/\bd="([^"]+)"/)?.[1];
  if (!d) {
    throw new Error(`Path missing d attribute: ${attrString}`);
  }

  const fillRule = attrString.match(/\bfill-rule="([^"]+)"/i)?.[1];
  const clipRule = attrString.match(/\bclip-rule="([^"]+)"/i)?.[1];

  const jsxAttrs = [`d="${d}"`];
  if (fillRule) {
    jsxAttrs.push(`fillRule="${fillRule}"`);
  }
  if (clipRule) {
    jsxAttrs.push(`clipRule="${clipRule}"`);
  }

  return jsxAttrs.join(" ");
}

function extractPaths(svgContent) {
  const paths = [];
  const pathRegex = /<path\b([^>]*)\/?>/gi;
  let match = pathRegex.exec(svgContent);

  while (match !== null) {
    paths.push(parsePathAttributes(match[1]));
    match = pathRegex.exec(svgContent);
  }

  if (paths.length === 0) {
    throw new Error("No <path> elements found in SVG");
  }

  return paths;
}

function parseLucideAttributes(attrString) {
  const attrs = [];
  const attrRegex = /([\w-:]+)="([^"]*)"/g;
  let match = attrRegex.exec(attrString);

  while (match !== null) {
    const name = match[1].toLowerCase();
    if (!LUCIDE_DROP_ATTRS.has(name)) {
      attrs.push(`${kebabToCamel(name)}="${match[2]}"`);
    }
    match = attrRegex.exec(attrString);
  }

  return attrs.join(" ");
}

function extractLucideInnerElements(svgContent) {
  const withoutComments = svgContent.replace(/<!--[\s\S]*?-->/g, "");
  const innerMatch = withoutComments.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);
  if (!innerMatch) {
    throw new Error("No <svg> wrapper found in lucide-static SVG");
  }

  const elements = [];
  const elementRegex =
    /<(path|circle|line|polyline|polygon|rect)\b([^>]*)\/?>/gi;
  let match = elementRegex.exec(innerMatch[1]);

  while (match !== null) {
    const tag = match[1];
    const attrs = parseLucideAttributes(match[2]);
    elements.push(attrs ? `<${tag} ${attrs} />` : `<${tag} />`);
    match = elementRegex.exec(innerMatch[1]);
  }

  if (elements.length === 0) {
    throw new Error("No inner lucide elements found in SVG");
  }

  return elements;
}

function renderMonoComponent(componentName, pathAttrs) {
  const pathLines = pathAttrs
    .map((attrs) => `      <path ${attrs} />`)
    .join("\n");

  return `export function ${componentName}({ size = 20, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={className}
    >
${pathLines}
    </svg>
  );
}
`;
}

function renderLucideComponent(exportName, innerElements) {
  const innerLines = innerElements
    .map((element) => `      ${element}`)
    .join("\n");

  return `export function ${exportName}({ size = 20, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
${innerLines}
    </svg>
  );
}
`;
}

function buildGeneratedBlock() {
  const lines = [GENERATED_START, ""];

  for (const glyph of GLYPHS) {
    const svgPath = path.join(monoSvgDir, `${glyph}.svg`);
    if (!fs.existsSync(svgPath)) {
      throw new Error(`Missing mono-icons glyph: ${glyph} (${svgPath})`);
    }

    const svgContent = fs.readFileSync(svgPath, "utf8");
    const pathAttrs = extractPaths(svgContent);
    lines.push(renderMonoComponent(toComponentName(glyph), pathAttrs));
  }

  lines.push("// Lucide bridge (lucide-static, ISC) — stroke mode", "");

  for (const { file, exportName } of LUCIDE_BRIDGE) {
    const svgPath = path.join(lucideSvgDir, `${file}.svg`);
    if (!fs.existsSync(svgPath)) {
      throw new Error(`Missing lucide-static glyph: ${file} (${svgPath})`);
    }

    const svgContent = fs.readFileSync(svgPath, "utf8");
    const innerElements = extractLucideInnerElements(svgContent);
    lines.push(renderLucideComponent(exportName, innerElements));
  }

  lines.push("export { RefreshIcon as SpinnerIcon };", "", GENERATED_END);
  return lines.join("\n");
}

function replaceGeneratedRegion(content, generatedBlock) {
  const startIndex = content.indexOf(GENERATED_START);
  const endIndex = content.indexOf(GENERATED_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `Missing ${GENERATED_START} / ${GENERATED_END} markers in ${outPath}`,
    );
  }

  const before = content.slice(0, startIndex);
  const after = content.slice(endIndex + GENERATED_END.length);
  return `${before}${generatedBlock}${after}`;
}

if (!fs.existsSync(outPath)) {
  throw new Error(
    `Missing ${outPath}. Create the manual block with GENERATED markers first.`,
  );
}

const existing = fs.readFileSync(outPath, "utf8");
const generatedBlock = buildGeneratedBlock();
const next = replaceGeneratedRegion(existing, generatedBlock);

fs.writeFileSync(outPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
console.log(`Wrote ${outPath}`);
