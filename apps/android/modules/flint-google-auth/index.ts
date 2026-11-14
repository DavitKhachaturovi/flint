/**
 * Google sign-in for Drive on Android (MOB-13, D-165, docs/05 §8): the native module's typed face.
 */
import { requireNativeModule } from 'expo';

export interface GoogleToken {
  readonly accessToken: string | null;
  readonly scopes: readonly string[];
}

interface FlintGoogleAuth {
  authorize(scopes: readonly string[], interactive: boolean): Promise<GoogleToken>;
  clearToken(token: string): Promise<void>;
}

const native = requireNativeModule<FlintGoogleAuth>('FlintGoogleAuth');

/** The one scope: only files Flint created (non-sensitive, D-161). */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** An access token for Drive; `interactive`: Google's consent may show. */
export function authorizeDrive(interactive: boolean): Promise<GoogleToken> {
  return native.authorize([DRIVE_SCOPE], interactive);
}

export function clearToken(token: string): Promise<void> {
  return native.clearToken(token);
}
