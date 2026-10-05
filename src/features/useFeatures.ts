import { usePlatform } from '../platform/store';
import { FEATURES, type FeatureModule } from './registry';

/** Feature modules for this app that are switched ON for the current department. */
export function useFeatures(app: string): FeatureModule[] {
  const { hasFeature } = usePlatform();
  return FEATURES.filter(f => f.app === app && hasFeature(f.key));
}
