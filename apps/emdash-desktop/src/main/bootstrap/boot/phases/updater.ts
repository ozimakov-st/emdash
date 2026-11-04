import { AUTO_UPDATE_DISABLED } from '@core/primitives/app-identity/api/app-identity';
import { updateService } from '@main/host/updates/update-service';
import { log } from '@main/lib/logger';

export async function initializeUpdater(): Promise<void> {
  // Fork (ozimakov-st): official updates would replace this build.
  if (AUTO_UPDATE_DISABLED) return;
  try {
    // initialize() is idempotent because recovery mode may also call it
    // after a failure in a later boot phase.
    await updateService.initialize();
  } catch (error) {
    log.warn('Failed to initialize auto-update service', { error });
  }
}
