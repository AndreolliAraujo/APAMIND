// Checagem de erro de XML (DOMParser).

// Checa erro do DOMParser (XML invalido)
export function checkParserError(doc: Document): string | null {
  const err = doc.querySelector("parsererror");
  if (err) return "XML inválido: " + (err.textContent || "").slice(0, 200);
  return null;
}
