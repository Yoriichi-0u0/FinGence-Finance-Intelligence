import "server-only";
import { createPostgresDatabase } from "../db/postgres";
import { PersistenceError, type PersistedAttempt } from "./contracts";
import { preparePersistencePlan } from "./map";
import { createPersistenceRepository, type PersistenceRepository } from "./repository";

export function createPersistenceService(repository: PersistenceRepository) {
  return {
    async persistNewAttempt(input: unknown): Promise<PersistedAttempt> {
      // Explicit opt-in for new history. No replay keys, retry modes or ambiguous writes.
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new PersistenceError("IDEMPOTENCY_UNSUPPORTED");
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Object.keys(descriptors).some(key => !["intent", "results", "source_file"].includes(key))
        || Object.values(descriptors).some(item => !("value" in item))
        || descriptors.intent?.value !== "NEW_ATTEMPT_NO_RETRY") throw new PersistenceError("IDEMPOTENCY_UNSUPPORTED");
      const plan = preparePersistencePlan({ results: descriptors.results?.value, source_file: descriptors.source_file?.value });
      try { return await repository.persistNewAttempt(plan); } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceError("PERSISTENCE_FAILED");
      }
    },
  };
}

/** Explicit server lifecycle: caller owns this service and must close it on shutdown. */
export function createServerPersistenceService() {
  const database = createPostgresDatabase();
  return { ...createPersistenceService(createPersistenceRepository(database)), close: () => database.close() };
}
