# Native iOS and App Store handoff

The package includes connected SwiftUI reference source and XcodeGen configuration; it is not compiled or signed in this Linux workspace. Extend the reference client to all mobile screen IDs using design/screens.json and docs/SCREEN_SPEC. Run builds on a Mac/macOS CI with installed supported Xcode.

## Build workflow
1. Install Xcode and XcodeGen on the build Mac, accept licenses and select the correct toolchain. Read official Apple docs for current minimum submission SDK.
2. Set real bundle identifier/team in the build environment. Generate the Xcode project from ios/project.yml; do not commit signing certificates or credentials.
3. Build simulator without signing, run Swift unit/UI tests, then configure signing and test on physical iPhone. Review exact API base URL and TLS trust. The reference source accepts only HTTPS, with loopback exception for local debugging.
4. Integrate OIDC/PKCE, Keychain refresh rotation, Face ID app-unlock and device token registration. Face ID protects an existing session; it is not a store facial recognition operation.
5. Complete APNs sandbox/production tests, notification routing after app-kill/logout/token rotation, denied-notification fallback and evidence fetch authorization.
6. Create app icon/assets and real application screenshots after build. Mockup PNGs are design assets, not App Store screenshots of a functioning build.
7. Prepare privacy policy, support URL, data collection disclosures, SDK privacy manifests and required-reason API declarations based on actual runtime usage. Request photo/camera/local-network permissions only for implemented features. Native responder need not scan store cameras itself; edge does discovery.
8. Use TestFlight internal pilot then customer/limited external testing as agreed. Provide a review account with synthetic data and live backend access; explain hardware-dependent flows and demo evidence.
9. Choose B2B distribution (public/unlisted/custom app through Apple Business Manager) appropriate to customers and confirm eligibility in App Store Connect. Do not assume enterprise in-house distribution is allowed for unrelated customers.
10. Submit only a validated signed release with no unresolved crash/permission/security/model-license blockers. Approval is Apple's decision and cannot be guaranteed.

## English draft product copy
Ayonix RetailGuard helps authorized retail teams review security alerts, inspect incident evidence and coordinate store response. Access assigned stores, acknowledge alerts, record review outcomes and search retained records. Features depend on your organization's connected camera system and enabled services. AI candidate signals require human review.

## 日本語紹介文
Ayonix RetailGuardは、店舗の防犯担当者がアラートと証拠映像を確認し、対応状況を共有するための業務アプリです。担当店舗の通知確認、対応開始、確認結果の記録、保存済み事案の検索に対応します。利用には組織の契約と接続済みカメラシステムが必要です。AIの検知情報は担当者による確認を前提としています。

## Device validation
iPhone small/large screens; light/dark; Japanese/English; max accessibility text; VoiceOver; Face ID denied/unavailable; camera/photos denied; push disabled; network change/offline; stale incident; two responders; video URL expires mid-play; device clock difference; signout; deleted photo/profile; background/foreground resume. Keep screenshots and logs from actual builds.

Primary sources:
https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
https://developer.apple.com/app-store/review/guidelines/
