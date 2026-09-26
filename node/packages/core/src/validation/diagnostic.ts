export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
    code: string;
    severity: DiagnosticSeverity;
    path: string;
    message: string;
}

export interface ValidationResult<T> {
    valid: boolean;
    diagnostics: Diagnostic[];
    value?: T;
}
