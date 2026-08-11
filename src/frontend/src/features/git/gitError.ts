import { catalogForCode } from "./errorCatalog";

type DetailObj = { code?: string; message?: string; msg?: string };

/**
 * Extract title + list from FastAPI git errors (`detail: {code, message}`).
 */
export function extractGitError(error: unknown): {
  title: string;
  list: string[];
  code?: string;
} {
  const detail = (
    error as { response?: { data?: { detail?: unknown } } }
  )?.response?.data?.detail;

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as DetailObj;
    const code = d.code;
    const catalog = catalogForCode(code);
    const message = d.message || d.msg || catalog.hint;
    return {
      title: catalog.title,
      list: [message, catalog.hint].filter(
        (v, i, arr) => Boolean(v) && arr.indexOf(v) === i,
      ),
      code,
    };
  }

  if (typeof detail === "string" && detail) {
    return { title: "Git error", list: [detail] };
  }

  const msg = (error as { message?: string })?.message;
  return {
    title: "Git error",
    list: [msg || "An unknown git error occurred"],
  };
}
