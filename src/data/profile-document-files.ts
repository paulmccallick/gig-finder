import path from "node:path";
import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import type { ManagedDocumentRecord } from "../core/documents";

export interface ProfileDocumentMaterializer {
  write(document: ManagedDocumentRecord): void;
}

export class LocalProfileDocumentFiles implements ProfileDocumentMaterializer {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  write(document: ManagedDocumentRecord): void {
    if (!document.links.some(link => link.entityType === "profile")) return;
    if (!document.filePath) {
      throw new Error(`Profile document ${document.id} has no file path.`);
    }
    const target = path.resolve(this.root, document.filePath);
    if (path.dirname(target) !== this.root) {
      throw new Error(`Profile document ${document.id} has an unsafe file path.`);
    }
    mkdirSync(this.root, { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, document.content, "utf8");
      renameSync(temporary, target);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
