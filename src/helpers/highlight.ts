/**
 * DOM ベースのハイライト・カーソル可視化ヘルパー。
 * page.evaluate() でオーバーレイを注入し、page.screenshot() に反映させる。
 */

const HIGHLIGHT_CONTAINER_ID = "__stagehand_highlight_container__";

const COLOR_PALETTE = [
  { bg: "rgba(255, 152, 0, 0.25)", border: "rgba(255, 152, 0, 0.8)" },
  { bg: "rgba(33, 150, 243, 0.25)", border: "rgba(33, 150, 243, 0.8)" },
  { bg: "rgba(156, 39, 176, 0.25)", border: "rgba(156, 39, 176, 0.8)" },
  { bg: "rgba(0, 150, 136, 0.25)", border: "rgba(0, 150, 136, 0.8)" },
  { bg: "rgba(244, 67, 54, 0.25)", border: "rgba(244, 67, 54, 0.8)" },
  { bg: "rgba(76, 175, 80, 0.25)", border: "rgba(76, 175, 80, 0.8)" },
  { bg: "rgba(255, 235, 59, 0.30)", border: "rgba(255, 193, 7, 0.8)" },
  { bg: "rgba(121, 85, 72, 0.25)", border: "rgba(121, 85, 72, 0.8)" },
];

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path d="M5 3l14 8-6.5 2L9 19.5z" fill="#222" stroke="#fff" stroke-width="1.5"/>
</svg>`;

interface HighlightElementOpts {
  showCursor?: boolean;
  label?: string;
  overlayColor?: string;
  borderColor?: string;
}

function resolveElement(selector: string): string {
  // Stagehand selectors may be xpath= prefixed or CSS
  if (selector.startsWith("xpath=")) {
    const xpath = selector.slice("xpath=".length);
    return `document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }
  return `document.querySelector(${JSON.stringify(selector)})`;
}

function ensureContainerScript(): string {
  return `
    (function() {
      let c = document.getElementById(${JSON.stringify(HIGHLIGHT_CONTAINER_ID)});
      if (!c) {
        c = document.createElement('div');
        c.id = ${JSON.stringify(HIGHLIGHT_CONTAINER_ID)};
        c.style.position = 'absolute';
        c.style.top = '0';
        c.style.left = '0';
        c.style.width = document.documentElement.scrollWidth + 'px';
        c.style.height = document.documentElement.scrollHeight + 'px';
        c.style.pointerEvents = 'none';
        c.style.zIndex = '2147483647';
        document.documentElement.appendChild(c);
      }
      return c;
    })()
  `;
}

/**
 * 単一要素をハイライト + オプションでカーソル表示。
 * act() のクリック対象の可視化用。
 */
export async function highlightElement(
  page: any,
  selector: string,
  opts: HighlightElementOpts = {}
): Promise<void> {
  const {
    showCursor = false,
    label = "",
    overlayColor = "rgba(255, 152, 0, 0.3)",
    borderColor = "rgba(255, 152, 0, 0.8)",
  } = opts;

  await page.evaluate(
    ({
      resolveExpr,
      overlayColor,
      borderColor,
      showCursor,
      label,
      cursorSvg,
      containerId,
    }: any) => {
      const el = eval(resolveExpr) as Element | null;
      if (!el) return;

      (el as HTMLElement).scrollIntoView?.({ block: "center", behavior: "instant" });

      // Wait a tick for scroll to settle
      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      // Ensure container
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement("div");
        container.id = containerId;
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = document.documentElement.scrollWidth + "px";
        container.style.height = document.documentElement.scrollHeight + "px";
        container.style.pointerEvents = "none";
        container.style.zIndex = "2147483647";
        document.documentElement.appendChild(container);
      }

      // Overlay box
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.left = (rect.left + scrollX - 3) + "px";
      overlay.style.top = (rect.top + scrollY - 3) + "px";
      overlay.style.width = (rect.width + 6) + "px";
      overlay.style.height = (rect.height + 6) + "px";
      overlay.style.background = overlayColor;
      overlay.style.border = `3px solid ${borderColor}`;
      overlay.style.borderRadius = "4px";
      overlay.style.boxSizing = "border-box";
      container.appendChild(overlay);

      // Label badge
      if (label) {
        const badge = document.createElement("div");
        badge.textContent = label;
        badge.style.position = "absolute";
        badge.style.left = (rect.left + scrollX - 3) + "px";
        badge.style.top = (rect.top + scrollY - 22) + "px";
        badge.style.background = borderColor;
        badge.style.color = "#fff";
        badge.style.fontSize = "11px";
        badge.style.fontFamily = "Arial, sans-serif";
        badge.style.fontWeight = "bold";
        badge.style.padding = "2px 6px";
        badge.style.borderRadius = "3px 3px 0 0";
        badge.style.whiteSpace = "nowrap";
        container.appendChild(badge);
      }

      // Cursor SVG
      if (showCursor) {
        const cursor = document.createElement("div");
        cursor.innerHTML = cursorSvg;
        cursor.style.position = "absolute";
        cursor.style.left = (rect.left + scrollX + rect.width / 2) + "px";
        cursor.style.top = (rect.top + scrollY + rect.height / 2) + "px";
        container.appendChild(cursor);
      }
    },
    {
      resolveExpr: resolveElement(selector),
      overlayColor,
      borderColor,
      showCursor,
      label,
      cursorSvg: CURSOR_SVG,
      containerId: HIGHLIGHT_CONTAINER_ID,
    }
  );
}

interface ObservedAction {
  selector: string;
  description: string;
  [key: string]: any;
}

/**
 * 複数要素をナンバリング付きでハイライト。
 * observe() 結果の可視化用。
 */
export async function highlightElements(
  page: any,
  actions: ObservedAction[]
): Promise<void> {
  await page.evaluate(
    ({ actions, palette, containerId }: any) => {
      // Ensure container
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement("div");
        container.id = containerId;
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = document.documentElement.scrollWidth + "px";
        container.style.height = document.documentElement.scrollHeight + "px";
        container.style.pointerEvents = "none";
        container.style.zIndex = "2147483647";
        document.documentElement.appendChild(container);
      }

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const color = palette[i % palette.length];

        let el: Element | null = null;
        try {
          if (action.selector.startsWith("xpath=")) {
            const xpath = action.selector.slice("xpath=".length);
            el = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as Element;
          } else {
            el = document.querySelector(action.selector);
          }
        } catch {
          continue;
        }
        if (!el) continue;

        const rect = el.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Overlay box
        const overlay = document.createElement("div");
        overlay.style.position = "absolute";
        overlay.style.left = (rect.left + scrollX - 2) + "px";
        overlay.style.top = (rect.top + scrollY - 2) + "px";
        overlay.style.width = (rect.width + 4) + "px";
        overlay.style.height = (rect.height + 4) + "px";
        overlay.style.background = color.bg;
        overlay.style.border = `2px solid ${color.border}`;
        overlay.style.borderRadius = "3px";
        overlay.style.boxSizing = "border-box";
        container.appendChild(overlay);

        // Number badge
        const badge = document.createElement("div");
        badge.textContent = String(i + 1);
        badge.style.position = "absolute";
        badge.style.left = (rect.left + scrollX - 2) + "px";
        badge.style.top = (rect.top + scrollY - 20) + "px";
        badge.style.background = color.border;
        badge.style.color = "#fff";
        badge.style.fontSize = "11px";
        badge.style.fontFamily = "Arial, sans-serif";
        badge.style.fontWeight = "bold";
        badge.style.padding = "1px 5px";
        badge.style.borderRadius = "3px 3px 0 0";
        badge.style.whiteSpace = "nowrap";
        badge.style.maxWidth = "200px";
        badge.style.overflow = "hidden";
        badge.style.textOverflow = "ellipsis";
        container.appendChild(badge);

        // Description tooltip (below the element)
        if (action.description) {
          const tip = document.createElement("div");
          tip.textContent = `${i + 1}. ${action.description}`;
          tip.style.position = "absolute";
          tip.style.left = (rect.left + scrollX - 2) + "px";
          tip.style.top = (rect.top + scrollY + rect.height + 4) + "px";
          tip.style.background = "rgba(0,0,0,0.75)";
          tip.style.color = "#fff";
          tip.style.fontSize = "10px";
          tip.style.fontFamily = "Arial, sans-serif";
          tip.style.padding = "2px 5px";
          tip.style.borderRadius = "2px";
          tip.style.whiteSpace = "nowrap";
          tip.style.maxWidth = "300px";
          tip.style.overflow = "hidden";
          tip.style.textOverflow = "ellipsis";
          container.appendChild(tip);
        }
      }
    },
    {
      actions: actions.map((a) => ({ selector: a.selector, description: a.description })),
      palette: COLOR_PALETTE,
      containerId: HIGHLIGHT_CONTAINER_ID,
    }
  );
}

/**
 * 注入したハイライトオーバーレイを除去する。
 */
export async function removeHighlights(page: any): Promise<void> {
  await page.evaluate((containerId: string) => {
    const c = document.getElementById(containerId);
    if (c) c.remove();
  }, HIGHLIGHT_CONTAINER_ID);
}
