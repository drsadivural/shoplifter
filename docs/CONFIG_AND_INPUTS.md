# Configuration and external inputs

## Local
reference init generates organization, administrator and hashed password. State directory is `reference/data` by default, or RETAILGUARD_DATA. The server binds 127.0.0.1; RETAILGUARD_PORT controls its local port. Do not commit generated state/photos/secrets.

## Production required inputs
APP_ENV, WEB_ORIGIN, API_ORIGIN, DATABASE_URL, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET or BFF credential, SESSION_SIGNING_KEY, KMS_KEY_ID, MEDIA_BUCKET, MEDIA_REGION, APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY_FILE, APNS_BUNDLE_ID, AYONIX_SDK_PACKAGE, AYONIX_LICENSE_FILE, MODEL_MANIFEST, EDGE_ALLOWED_SUBNETS. Provide these securely; startup validates dependencies, license and URL schemes. No example secret values are accepted as production configuration.

Model manifest records algorithm/version/source commit, code/data/weights rights, SHA256, preprocessing version, input/output shapes, keypoint/channel order, sampling rate/window/stride, normalization, precision/backend/runtime and held-out validation report. Those values must come from the actual exported trained model, not a generic manifest copied into every model.

Organization setup resolves who can enroll/approve/export, which stores share an approved gallery, purpose/retention, camera coverage, responder on-call and physical deployment. Need an actual licensed SDK/manual and training data rights before face/behavior release. Need Mac/Xcode/Apple organization/signing and real device for App Store/APNs acceptance.

The package can be implemented without Veesion/Dragonfruit/3DiVi vendor accounts. Optional vendor comparison or POS/RFID integration requires the specific vendor's supported API/access and commercial arrangement. Do not invent or scrape restricted interfaces.

Shopformer source/checkpoint availability is unresolved in the inspected official repository; the README is not an executable model package. Resolve that dependency or validate an independent implementation before committing to its production integration.
