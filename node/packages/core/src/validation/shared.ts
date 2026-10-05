import type { IDiagnostic } from "./diagnostic";

export type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function addError(diagnostics: IDiagnostic[], code: string, path: string, message: string): void {
    diagnostics.push({ code, severity: "error", path, message });
}

export function addWarning(diagnostics: IDiagnostic[], code: string, path: string, message: string): void {
    diagnostics.push({ code, severity: "warning", path, message });
}

export function validateRootProperties(value: RecordValue, path: string, diagnostics: IDiagnostic[]): void {
    if (value.extensions !== undefined && !isRecord(value.extensions)) {
        addError(diagnostics, "INVALID_EXTENSIONS", `${path}/extensions`, "Expected an object keyed by extension name.");
    }
}
