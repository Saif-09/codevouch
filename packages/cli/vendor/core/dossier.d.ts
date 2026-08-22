import type { Db } from './db.js';
import type { ExtractionBackend } from './extraction.js';
import type { Repo } from './ingest.js';
export interface DossierBody {
    what_it_does_here: string;
    replaced?: string | null;
    if_it_vanished: string;
    probe_question: string;
    probe_expected: string;
}
/**
 * Spec §7.1. The dossier row exists as soon as the keyless feeds answer;
 * the extraction body is best-effort and retried on later passes. The
 * universal fallback probe is the canonical "if it vanished tomorrow"
 * question, so a dossier rep works even when extraction is down.
 */
export declare function generateDossier(db: Db, repo: Repo, backend: ExtractionBackend, nodeId: string): Promise<void>;
