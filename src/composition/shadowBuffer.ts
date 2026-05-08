import { applyTextPatch, createTextPatch, type CompositionPatch } from "./patch.js";

export interface ShadowBufferSnapshot {
  sessionId: string;
  baseText: string;
  currentText: string;
  committedStableText: string;
  revision: number;
  active: boolean;
}

export class ShadowBuffer {
  private currentText: string;
  private committedStableText = "";
  private revision = 0;
  private active = true;

  constructor(
    private readonly sessionId: string,
    private readonly baseText = "",
  ) {
    this.currentText = baseText;
  }

  updatePreview(previewText: string): CompositionPatch {
    return this.replaceCurrent(this.baseText + previewText, "preview");
  }

  commitStable(stableText: string): CompositionPatch {
    this.committedStableText = stableText;
    return this.replaceCurrent(this.baseText + stableText, "stable");
  }

  finalReplace(finalText: string): CompositionPatch {
    this.committedStableText = finalText;
    const patch = this.replaceCurrent(this.baseText + finalText, "final");
    this.active = false;
    return patch;
  }

  rollback(): CompositionPatch {
    const patch = this.replaceCurrent(this.baseText, "rollback");
    this.committedStableText = "";
    this.active = false;
    return patch;
  }

  applyExternalPatch(patch: CompositionPatch): void {
    this.currentText = applyTextPatch(this.currentText, patch);
    this.revision = Math.max(this.revision, patch.revision);
  }

  snapshot(): ShadowBufferSnapshot {
    return {
      sessionId: this.sessionId,
      baseText: this.baseText,
      currentText: this.currentText,
      committedStableText: this.committedStableText,
      revision: this.revision,
      active: this.active,
    };
  }

  private replaceCurrent(
    nextText: string,
    kind: "preview" | "stable" | "final" | "rollback",
  ): CompositionPatch {
    this.revision += 1;
    const patch = createTextPatch(this.currentText, nextText, this.revision, kind);
    this.currentText = applyTextPatch(this.currentText, patch);
    return patch;
  }
}
