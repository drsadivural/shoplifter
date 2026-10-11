import SwiftUI
import UIKit
import AVFoundation
import PhotosUI
import RetailGuardCore

/// Camera session for reference-photo capture (AVFoundation).
@MainActor
@Observable
final class CameraCaptureModel: NSObject {
    enum Status: Equatable {
        case idle
        case requestingPermission
        case denied
        case restricted
        case unavailable
        case running
        case failed(String)
    }

    private(set) var status: Status = .idle
    private(set) var position: AVCaptureDevice.Position = .back
    private(set) var capturedData: Data?
    private(set) var isCapturing = false

    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "com.ayonix.retailguard.camera")
    @ObservationIgnored private var configured = false
    @ObservationIgnored private var continuation: CheckedContinuation<Data?, Never>?

    func start() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            status = .requestingPermission
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            guard granted else { status = .denied; return }
        case .denied:
            status = .denied
            return
        case .restricted:
            status = .restricted
            return
        @unknown default:
            status = .unavailable
            return
        }
        do {
            try configure(position: position)
            let session = self.session
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                sessionQueue.async {
                    if !session.isRunning { session.startRunning() }
                    done.resume()
                }
            }
            status = .running
        } catch {
            status = .unavailable
        }
    }

    func stop() {
        if status == .running { status = .idle }
        let session = self.session
        sessionQueue.async {
            if session.isRunning { session.stopRunning() }
        }
    }

    func switchCamera() {
        let next: AVCaptureDevice.Position = position == .back ? .front : .back
        do {
            try configure(position: next)
            position = next
        } catch {
            status = .failed(L("The other camera is not available."))
        }
    }

    private func configure(position: AVCaptureDevice.Position) throws {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
            throw CaptureError.noDevice
        }
        let input = try AVCaptureDeviceInput(device: device)
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        for existing in session.inputs { session.removeInput(existing) }
        guard session.canAddInput(input) else { throw CaptureError.noDevice }
        session.addInput(input)
        if !configured {
            guard session.canAddOutput(output) else { throw CaptureError.noDevice }
            session.addOutput(output)
            configured = true
        }
    }

    func capture() async {
        guard status == .running, !isCapturing else { return }
        isCapturing = true
        defer { isCapturing = false }
        let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        let data: Data? = await withCheckedContinuation { continuation in
            self.continuation = continuation
            output.capturePhoto(with: settings, delegate: self)
        }
        capturedData = data
        if data == nil { status = .failed(L("The photo could not be captured. Try again.")) }
    }

    func retake() {
        capturedData = nil
        if case .failed = status { status = .running }
    }

    fileprivate func finish(_ data: Data?) {
        continuation?.resume(returning: data)
        continuation = nil
    }

    enum CaptureError: Error { case noDevice }
}

extension CameraCaptureModel: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = error == nil ? photo.fileDataRepresentation() : nil
        Task { @MainActor in self.finish(data) }
    }
}

/// Live camera preview layer.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

/// ios-23 — Capture reference photo with framing guidance, retake and upload
/// with progress. Uploaded photos are never auto-approved.
struct PhotoCaptureView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.openURL) private var openURL
    let profileId: String

    @State private var camera = CameraCaptureModel()
    @State private var provenance = ""
    @State private var uploading = false
    @State private var error: String?
    @State private var libraryItem: PhotosPickerItem?
    @State private var prepared: PreparedPhoto?

    var body: some View {
        ScreenScaffold(title: L("Capture reference photo"), showsStoreSubtitle: false) {
            guidance
            captureArea
            if let prepared {
                reviewSection(prepared)
            }
            if let error { FieldError(text: error) }
            PhotosPicker(selection: $libraryItem, matching: .images) {
                Label(L("Choose from photo library"), systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.rgSecondaryWide)
        }
        .task { await camera.start() }
        .onDisappear { camera.stop() }
        .onChange(of: camera.capturedData) { _, data in
            guard let data else { prepared = nil; return }
            prepare(data)
        }
        .onChange(of: libraryItem) { _, item in
            Task {
                guard let item, let data = try? await item.loadTransferable(type: Data.self) else { return }
                prepare(data)
                if provenance.isEmpty { provenance = L("Selected from photo library on iOS") }
            }
        }
    }

    private var guidance: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(L("Face fully visible"), systemImage: "person.crop.square")
            Label(L("Neutral pose"), systemImage: "face.smiling")
            Label(L("Good lighting"), systemImage: "sun.max")
        }
        .font(.subheadline)
        .rgCard()
    }

    @ViewBuilder private var captureArea: some View {
        switch camera.status {
        case .denied:
            VStack(spacing: 8) {
                StateMessageView(systemImage: "camera.badge.ellipsis", title: L("Camera access is off"),
                                 message: L("Allow camera access in Settings to take reference photos, or choose an existing photo."),
                                 tone: .warning)
                Button(L("Open Settings")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.rgSecondary)
            }
        case .restricted:
            StateMessageView(systemImage: "camera.badge.ellipsis", title: L("Camera restricted"),
                             message: L("Camera use is restricted on this device by its administrator."), tone: .warning)
        case .unavailable:
            StateMessageView(systemImage: "camera", title: L("Camera unavailable"),
                             message: L("No camera is available. Choose an existing photo instead."), tone: .neutral)
        case .idle, .requestingPermission:
            LoadingStateView(text: L("Starting camera…"))
        case .running, .failed:
            if prepared == nil {
                ZStack {
                    CameraPreview(session: camera.session)
                        .frame(height: 380)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .accessibilityLabel(L("Camera preview"))
                    Ellipse()
                        .strokeBorder(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 3, dash: [8, 6]))
                        .frame(width: 200, height: 260)
                        .accessibilityHidden(true)
                }
                if case .failed(let message) = camera.status { FieldError(text: message) }
                HStack(spacing: 16) {
                    Button {
                        camera.switchCamera()
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath.camera").rgTapTarget()
                    }
                    .accessibilityLabel(L("Switch camera"))
                    Spacer()
                    Button {
                        Task { await camera.capture() }
                    } label: {
                        Label(L("Take photo"), systemImage: "camera.circle.fill")
                    }
                    .buttonStyle(.rgPrimary)
                    .disabled(camera.isCapturing)
                }
            }
        }
    }

    private func reviewSection(_ photo: PreparedPhoto) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(uiImage: photo.preview)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 360)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .accessibilityLabel(L("Captured photo"))
            Text(LF("%@ × %@ px · JPEG", String(photo.info.width), String(photo.info.height)))
                .font(.caption.monospacedDigit())
                .foregroundStyle(Color.rgSecondaryText)
            LabeledInput(label: L("Provenance"), hint: L("How and where this photo was obtained."), error: nil) {
                TextField(L("Required"), text: $provenance)
            }
            HStack {
                Button(L("Retake")) {
                    prepared = nil
                    libraryItem = nil
                    camera.retake()
                }
                .buttonStyle(.rgSecondary)
                Spacer()
                Button {
                    Task { await upload(photo) }
                } label: {
                    HStack {
                        if uploading { ProgressView().tint(Color.rgOnPrimary) }
                        Text(uploading ? L("Uploading…") : L("Use photo"))
                    }
                }
                .buttonStyle(.rgPrimary)
                .disabled(uploading)
            }
            FieldHint(text: L("Quality is checked by the server after upload. The photo stays pending until a reviewer approves it."))
        }
        .rgCard()
    }

    private func prepare(_ data: Data) {
        error = nil
        do {
            prepared = try PreparedPhoto.make(from: data)
            if provenance.isEmpty { provenance = L("Captured with the RetailGuard iOS app") }
        } catch let failure as ImageInspector.Failure {
            error = PreparedPhoto.message(for: failure)
        } catch {
            self.error = L("The photo could not be read.")
        }
    }

    private func upload(_ photo: PreparedPhoto) async {
        let trimmed = provenance.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            error = L("Describe the photo's provenance.")
            return
        }
        uploading = true
        defer { uploading = false }
        do {
            let created = try await appState.api.uploadPhoto(profileId: profileId, imageData: photo.jpegData,
                                                             mimeType: "image/jpeg", provenance: trimmed)
            prepared = nil
            camera.stop()
            appState.replaceTop(with: .photoQuality(profileId: profileId, photoId: created.id))
        } catch {
            let failure = appState.present(error)
            self.error = failure.kind == .offline
                ? L("You're offline. The photo was not uploaded; try again when connected.")
                : failure.message
        }
    }
}
