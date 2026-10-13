// A small checker of XML for the export tests: is this text well-formed? It
// walks the tags and makes sure each one that opens is closed in turn, that
// attributes are quoted and that no bare & or < stands in the text. It is
// not a full XML reader, but it catches what a hand-written file gets wrong.

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  /** The names of the elements directly inside, in order. */
  readonly children: string[];
  /** Where the element sits: the names from the root down to it. */
  readonly path: readonly string[];
}

/** Every element of an XML text, in the order they open. Throws, saying where, when the text is not well-formed. */
export function readXml(xml: string): XmlElement[] {
  const elements: XmlElement[] = [];
  const open: XmlElement[] = [];
  const body = xml.replace(/^<\?xml [^?]*\?>\s*/, '');
  if (body.includes('<?')) throw new Error('a second XML declaration');
  const token = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy;
  let at = 0;
  let roots = 0;
  while (at < body.length) {
    token.lastIndex = at;
    const match = token.exec(body);
    if (!match) throw new Error(`not well-formed at ${at}: ${body.slice(at, at + 60)}`);
    at = token.lastIndex;
    const [, closing, name, attributeText, selfClosing, text] = match;
    if (text !== undefined) {
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(text)) throw new Error(`a bare & in "${text.slice(0, 40)}"`);
      if (open.length === 0 && text.trim() !== '') throw new Error('text outside the root element');
      continue;
    }
    if (closing) {
      const last = open.pop();
      if (!last || last.name !== name) throw new Error(`</${name}> closes <${last?.name ?? 'nothing'}>`);
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of (attributeText ?? '').matchAll(/([\w:.-]+)="([^"]*)"/g)) {
      const key = attribute[1] as string;
      if (key in attributes) throw new Error(`<${name}> has two "${key}" attributes`);
      if (/&(?!(amp|lt|gt|quot|apos);)/.test(attribute[2] ?? '')) throw new Error(`a bare & in an attribute of <${name}>`);
      attributes[key] = attribute[2] ?? '';
    }
    const parent = open[open.length - 1];
    if (parent) parent.children.push(name as string);
    else roots++;
    const element: XmlElement = { name: name as string, attributes, children: [], path: [...open.map((entry) => entry.name), name as string] };
    elements.push(element);
    if (!selfClosing) open.push(element);
  }
  if (open.length > 0) throw new Error(`<${open[open.length - 1]?.name}> is never closed`);
  if (roots !== 1) throw new Error(`${roots} root elements`);
  return elements;
}

/** The text of an XML or HTML fragment as a reader sees it: tags out, the five named characters back. */
export function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
