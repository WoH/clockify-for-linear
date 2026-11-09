export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text;

  return node;
}

/** Parses trusted, static SVG markup. Never pass it data from Clockify or the page. */
export function svg(markup: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = markup;

  return template.content;
}
