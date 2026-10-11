# Connected native reference client

Build on macOS with Xcode and XcodeGen:

```bash
cd ios
xcodegen generate
xcodebuild -project RetailGuardReference.xcodeproj -scheme RetailGuardReference -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

Set your actual API origin in the sign-in screen. The included server is loopback-only: an iOS simulator on the same Mac can use local networking; a physical iPhone needs a separately configured HTTPS staging API. Keep transport exceptions debug-only and test them on the build Mac. Never expose the reference server publicly.

This source implements native connected login/session storage, biometric unlock, manual incident listing/review/outcome, text search, staff/subject profile creation and photo upload/display. It is not the completed 34-screen production application: all required screens and production extensions are specified in design/screens.json and docs/IOS_RELEASE.md. No real face inference, raw-camera detector or APNs provider is represented as implemented. Xcode compilation/signing/device tests are unverified in the authoring environment.
