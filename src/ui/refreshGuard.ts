export function shouldSkipAutoRefresh(
  activeElement: Element | null,
  rootElement?: Element | null,
  pointerInside = false
): boolean {
  if (pointerInside) {
    return true;
  }

  if (rootElement?.matches(":hover")) {
    return true;
  }

  if (!activeElement) {
    return false;
  }

  if (isEditingElement(activeElement)) {
    return true;
  }

  return false;
}

function isEditingElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  if (["input", "select", "textarea"].includes(tagName)) {
    return true;
  }

  const editable = element.getAttribute("contenteditable");
  return editable === "" || editable === "true";
}
