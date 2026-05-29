import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

/**
 * Lance fake-gcs-server (https://github.com/fsouza/fake-gcs-server)
 * pour tester le driver STORAGE_DRIVER=gcs sans GCP réel.
 *
 * Le serveur accepte tous les buckets et signe les URLs avec sa propre clé.
 * Le SDK @google-cloud/storage utilise l'override `apiEndpoint`.
 */
export interface StartedFakeGcs {
  container: StartedTestContainer;
  endpoint: string;
  bucket: string;
  stop: () => Promise<void>;
}

export async function startFakeGcs(bucketName = 'test-bucket'): Promise<StartedFakeGcs> {
  const container = await new GenericContainer('fsouza/fake-gcs-server:1.49.2')
    .withCommand([
      '-scheme', 'http',
      '-port', '4443',
      '-external-url', 'http://__HOST__:__PORT__',
      '-public-host', '__HOST__:__PORT__',
    ])
    .withExposedPorts(4443)
    .withWaitStrategy(Wait.forLogMessage(/server started at/i))
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(4443);
  const endpoint = `http://${host}:${port}`;

  // Le serveur a démarré avec __HOST__ placeholder qu'il ne résout pas tout seul.
  // Cf. https://github.com/fsouza/fake-gcs-server/issues/201 : on doit
  // restart avec la vraie URL OU créer le bucket via API + utiliser external-url=endpoint.
  // Solution simple : créer le bucket via l'API REST de fake-gcs-server.
  const fetchRes = await fetch(`${endpoint}/storage/v1/b`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: bucketName }),
  });
  if (!fetchRes.ok && fetchRes.status !== 409) {
    const t = await fetchRes.text();
    throw new Error(`Failed to create fake-gcs bucket: ${fetchRes.status} ${t}`);
  }

  return {
    container,
    endpoint,
    bucket: bucketName,
    stop: async () => { await container.stop(); },
  };
}
