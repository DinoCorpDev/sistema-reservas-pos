import { argon2Verify } from 'hash-wasm';

/**
 * Verifies a PIN against the argon2id hashes of the candidates, off the main thread so the PIN
 * pad stays responsive (DEC-023). Answers with the index of the matching hash, or -1.
 */
type Request = { id: number; pin: string; hashes: string[] };

// The app compiles with the DOM library; only these two members of the worker scope are used.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: { id: number; index: number }): void;
};

scope.onmessage = async (event) => {
  const { id, pin, hashes } = event.data;
  for (let index = 0; index < hashes.length; index += 1) {
    try {
      if (await argon2Verify({ password: pin, hash: hashes[index]! })) {
        scope.postMessage({ id, index });
        return;
      }
    } catch {
      // A malformed hash never matches.
    }
  }
  scope.postMessage({ id, index: -1 });
};
