export type DiagnosticSeverity = "error" | "warning";

export interface IDiagnostic {
    code: string;
    severity: DiagnosticSeverity;
    path: string;
    message: string;
}

export interface IValidationResult<T> {
    valid: boolean;
    diagnostics: IDiagnostic[];
    value?: T;
}
