; RetailGuard Edge for Windows — setup wizard (Inno Setup 6.3+).
;
;   iscc /DAppVersion=0.3.0 /O..\..\dist RetailGuardEdge.iss
;
; Fresh install: Welcome > License > Server > (install: 6 steps with progress) > Connect to a store
; (pairing code, retried in place on error) > Finished. Running the same or a newer setup again is an
; update: the pages that ask for input are skipped when the PC is already paired, the config, pairing
; identity and camera credentials in %ProgramData%\RetailGuard\Edge are kept, and the agent restarts.
;
; Silent: RetailGuardEdgeSetup.exe /VERYSILENT /SUPPRESSMSGBOXES [/SERVER=https://...] [/CODE=XXXX-XXXX-XXXX] [/NAME="Store 1"]

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppIdRaw "8E3C2F4A-6C1B-4B7E-9F0A-5D2E7C1A9B30"
#define DefaultServer "https://shoplifter.ayonix.com"
; Keep in sync with $FfmpegUrl / $FfmpegSha256 in install-windows.ps1.
#define FfmpegUrl "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip"
#define FfmpegSha256 "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"

[Setup]
AppId={{{#AppIdRaw}}
AppName=RetailGuard Edge
AppVersion={#AppVersion}
AppVerName=RetailGuard Edge {#AppVersion}
AppPublisher=Ayonix
AppPublisherURL={#DefaultServer}
AppSupportURL={#DefaultServer}
VersionInfoVersion={#AppVersion}
VersionInfoDescription=RetailGuard Edge Setup
DefaultDirName={autopf}\RetailGuard\Edge
DisableDirPage=yes
DisableProgramGroupPage=yes
DefaultGroupName=RetailGuard
UsePreviousAppDir=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern
DisableWelcomePage=no
DisableReadyPage=no
WizardSizePercent=110
WizardImageFile=art\side-100.bmp,art\side-125.bmp,art\side-150.bmp,art\side-175.bmp,art\side-200.bmp,art\side-225.bmp,art\side-250.bmp
WizardSmallImageFile=art\small-100.bmp,art\small-125.bmp,art\small-150.bmp,art\small-175.bmp,art\small-200.bmp,art\small-225.bmp,art\small-250.bmp
SetupIconFile=art\retailguard.ico
UninstallDisplayIcon={app}\retailguard.ico
UninstallDisplayName=RetailGuard Edge
LicenseFile=..\..\..\..\LICENSE
OutputBaseFilename=RetailGuardEdgeSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ChangesEnvironment=yes
CloseApplications=no
SetupLogging=yes
ShowLanguageDialog=auto

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl"

[CustomMessages]
en.ServerTitle=RetailGuard server
en.ServerSubtitle=Where should this PC connect?
en.ServerIntro=Enter the address of your RetailGuard console. Leave it unchanged unless your administrator gave you a different address.
en.ServerLabel=Server address:
en.ServerInvalid=Enter an address that starts with https://, for example {#DefaultServer}.
en.ConnectTitle=Connect this PC to a store
en.ConnectSubtitle=Pair the edge appliance with its store.
en.ConnectIntro=In the RetailGuard console open the store, choose "Connect edge appliance" and create a pairing code. The code works once and is valid for 15 minutes.
en.CodeLabel=Pairing code:
en.NameLabel=Appliance name (shown in the console):
en.PairLater=&Pair later (run this setup again with a code)
en.UpdateButton=&Update
en.ReadyUpdateTitle=Ready to update
en.ReadyUpdateSubtitle=Setup is ready to update RetailGuard Edge on this computer.
en.ReadyUpdateText=Click Update to continue. The edge agent stops for a minute while it is updated.
en.CodeInvalid=Enter the pairing code shown in the console, for example ABCD-EFGH-JKLM.
en.NameInvalid=Enter a name for this appliance.
en.PairRejected=The server did not accept this pairing code. It may be mistyped, already used or expired (codes are valid for 15 minutes). Create a new code in the console and try again.
en.PairUnreachable=The RetailGuard server could not be reached. Check the internet connection and the server address, then try again.
en.PairFailed=Pairing failed:%n%n%1
en.UpdateWelcome=This will update RetailGuard Edge from version %1 to %2.%n%nThe connection to your store, the settings and the camera passwords are kept. The edge agent restarts when the update is finished.
en.StepOf=Step %1 of %2
en.StepPrepare=Preparing folders and permissions…
en.StepRuntime=Installing the Python runtime (first install downloads about 30 MB)…
en.StepDependencies=Installing RetailGuard Edge components…
en.StepFfmpeg=Setting up ffmpeg for video…
en.DownloadTitle=Downloading ffmpeg
en.DownloadSubtitle=ffmpeg reads the camera video. About 110 MB is downloaded once from github.com.
en.DownloadFailed=ffmpeg could not be downloaded:%n%n%1%n%nCheck the internet connection (github.com must be reachable) and click Install again.
en.StepConfigure=Writing the configuration…
en.StepService=Starting the background service…
en.PhaseFailed=Setup could not finish this step:%n%n%1%n%nDetails are in %2.
en.DoneConnected=RetailGuard Edge %1 is installed and running on this PC, connected to your store.%n%nAdd cameras in the RetailGuard console: Cameras > Discover. Network cameras and USB cameras connected to this PC are found automatically.
en.DoneNotPaired=RetailGuard Edge %1 is installed but not yet connected to a store.%n%nCreate a pairing code in the console (store > Connect edge appliance) and run this setup again to connect.
en.DoneFailed=Setup did not finish: %1%n%nDetails: %2%nRun this setup again after fixing the problem; it continues where it stopped.
en.OpenConsole=Open the RetailGuard console
en.ConsoleShortcut=RetailGuard console
en.RemoveDataAsk=Also delete this PC's store connection, settings and camera passwords?%n%nChoose No to keep them for a later reinstall. If this PC will not be used again, also remove it from the store in the RetailGuard console.
en.ReadyServer=Server:
en.ReadyMode=Update from version %1 to %2
en.ReadyKeep=The existing store connection and settings are kept.

ja.ServerTitle=RetailGuard サーバー
ja.ServerSubtitle=この PC の接続先を指定します。
ja.ServerIntro=RetailGuard コンソールのアドレスを入力してください。管理者から別のアドレスを指定されていない場合は、そのままにしてください。
ja.ServerLabel=サーバーのアドレス:
ja.ServerInvalid=https:// で始まるアドレスを入力してください（例: {#DefaultServer}）。
ja.ConnectTitle=この PC を店舗に接続
ja.ConnectSubtitle=エッジ端末を店舗とペアリングします。
ja.ConnectIntro=RetailGuard コンソールで店舗を開き「エッジ端末を接続」からペアリングコードを作成してください。コードは1回限り、15分間有効です。
ja.CodeLabel=ペアリングコード:
ja.NameLabel=エッジ端末の名前（コンソールに表示されます）:
ja.PairLater=後でペアリングする（コードを用意してこのセットアップを再実行）(&P)
ja.UpdateButton=更新(&U)
ja.ReadyUpdateTitle=更新の準備完了
ja.ReadyUpdateSubtitle=この PC の RetailGuard Edge を更新する準備ができました。
ja.ReadyUpdateText=「更新」をクリックして続行してください。更新中はエッジエージェントが1分ほど停止します。
ja.CodeInvalid=コンソールに表示されたペアリングコードを入力してください（例: ABCD-EFGH-JKLM）。
ja.NameInvalid=このエッジ端末の名前を入力してください。
ja.PairRejected=サーバーがこのペアリングコードを受け付けませんでした。入力間違い、使用済み、または有効期限切れ（15分）の可能性があります。コンソールで新しいコードを作成して、もう一度お試しください。
ja.PairUnreachable=RetailGuard サーバーに接続できませんでした。インターネット接続とサーバーのアドレスを確認して、もう一度お試しください。
ja.PairFailed=ペアリングに失敗しました:%n%n%1
ja.UpdateWelcome=RetailGuard Edge をバージョン %1 から %2 に更新します。%n%n店舗との接続、設定、カメラのパスワードはそのまま保持されます。更新が完了するとエッジエージェントが再起動します。
ja.StepOf=手順 %1 / %2
ja.StepPrepare=フォルダーと権限を準備しています…
ja.StepRuntime=Python ランタイムをインストールしています（初回は約 30 MB をダウンロード）…
ja.StepDependencies=RetailGuard Edge のコンポーネントをインストールしています…
ja.StepFfmpeg=映像処理用の ffmpeg を準備しています…
ja.DownloadTitle=ffmpeg をダウンロードしています
ja.DownloadSubtitle=ffmpeg はカメラ映像の読み取りに使用します。github.com から約 110 MB を一度だけダウンロードします。
ja.DownloadFailed=ffmpeg をダウンロードできませんでした:%n%n%1%n%nインターネット接続（github.com への接続）を確認して、もう一度「インストール」をクリックしてください。
ja.StepConfigure=設定を書き込んでいます…
ja.StepService=バックグラウンドサービスを開始しています…
ja.PhaseFailed=次の手順を完了できませんでした:%n%n%1%n%n詳細は %2 を確認してください。
ja.DoneConnected=RetailGuard Edge %1 がこの PC にインストールされ、店舗に接続して動作しています。%n%nRetailGuard コンソールの「カメラ」>「検索」でカメラを追加してください。ネットワークカメラと、この PC に接続された USB カメラが自動的に見つかります。
ja.DoneNotPaired=RetailGuard Edge %1 はインストールされましたが、まだ店舗に接続されていません。%n%nコンソール（店舗 >「エッジ端末を接続」）でペアリングコードを作成し、このセットアップを再実行して接続してください。
ja.DoneFailed=セットアップを完了できませんでした: %1%n%n詳細: %2%n問題を解決してからセットアップを再実行してください。中断した手順から再開します。
ja.OpenConsole=RetailGuard コンソールを開く
ja.ConsoleShortcut=RetailGuard コンソール
ja.RemoveDataAsk=この PC の店舗接続、設定、カメラのパスワードも削除しますか？%n%n再インストール時に使う場合は「いいえ」を選んでください。この PC を今後使用しない場合は、RetailGuard コンソールで店舗からも削除してください。
ja.ReadyServer=サーバー:
ja.ReadyMode=バージョン %1 から %2 への更新
ja.ReadyKeep=既存の店舗接続と設定はそのまま保持されます。

[Files]
Source: "..\..\src\*"; DestDir: "{app}\src"; Excludes: "__pycache__,*.pyc"; Flags: recursesubdirs ignoreversion
Source: "..\..\pyproject.toml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\uv.lock"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config.example.toml"; DestDir: "{app}\deploy"; Flags: ignoreversion
Source: "..\install-windows.ps1"; DestDir: "{app}\deploy"; Flags: ignoreversion
Source: "..\uninstall-windows.ps1"; DestDir: "{app}\deploy"; Flags: ignoreversion
Source: "art\retailguard.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; Modules removed in a newer version must not linger next to the new ones.
Type: filesandordirs; Name: "{app}\src"

[INI]
Filename: "{app}\RetailGuard console.url"; Section: "InternetShortcut"; Key: "URL"; String: "{code:ConsoleUrl}"

[Icons]
Name: "{group}\{cm:ConsoleShortcut}"; Filename: "{app}\RetailGuard console.url"; IconFilename: "{app}\retailguard.ico"
Name: "{group}\{cm:UninstallProgram,RetailGuard Edge}"; Filename: "{uninstallexe}"

[Run]
Filename: "{code:ConsoleUrl}"; Description: "{cm:OpenConsole}"; Flags: postinstall shellexec nowait skipifsilent; Check: IsConnected

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.venv"
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\ffmpeg"
Type: filesandordirs; Name: "{app}\uv-cache"
Type: filesandordirs; Name: "{app}\bin"
Type: filesandordirs; Name: "{app}\src"
Type: files; Name: "{app}\RetailGuard console.url"
Type: dirifempty; Name: "{app}"
Type: dirifempty; Name: "{autopf}\RetailGuard"

[Code]
const
  TaskName = 'RetailGuard Edge';
  EnvKey = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment';

var
  DownloadPage: TDownloadWizardPage;
  FfmpegDownloaded: Boolean;
  ServerPage: TInputQueryWizardPage;
  ConnectPage: TInputQueryWizardPage;
  PairLaterBox: TNewCheckBox;
  Upgrading, SetupFailed, PairedNow: Boolean;
  PrevVersion, FailureText: String;

function DataDir: String; begin Result := ExpandConstant('{commonappdata}\RetailGuard\Edge'); end;
function StateDir: String; begin Result := DataDir + '\state'; end;
function ConfigFile: String; begin Result := DataDir + '\config.toml'; end;
function SetupLog: String; begin Result := DataDir + '\logs\setup.log'; end;
function AgentExe: String; begin Result := ExpandConstant('{app}\.venv\Scripts\retailguard-edge.exe'); end;
function IsPaired: Boolean; begin Result := FileExists(StateDir + '\edge.json'); end;
function IsConnected: Boolean; begin Result := (not SetupFailed) and IsPaired; end;
function FfmpegZip: String; begin Result := ExpandConstant('{tmp}\ffmpeg.zip'); end;

{ ffmpeg and ffprobe already installed by an earlier run, or on PATH. }
function FfmpegPresent: Boolean;
begin
  Result := (FileExists(ExpandConstant('{app}\ffmpeg\bin\ffmpeg.exe')) and FileExists(ExpandConstant('{app}\ffmpeg\bin\ffprobe.exe')))
    or ((FileSearch('ffmpeg.exe', GetEnv('PATH')) <> '') and (FileSearch('ffprobe.exe', GetEnv('PATH')) <> ''));
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  Result := True;
end;

function UninstallKey: String;
begin
  Result := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{' + '{#AppIdRaw}' + '}_is1';
end;

{ api_base_url from an existing config (kept on update), else '' }
function ConfiguredServer: String;
var
  Lines: TArrayOfString;
  I, P: Integer;
  S: String;
begin
  Result := '';
  if not LoadStringsFromFile(ConfigFile, Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    S := Trim(Lines[I]);
    if Pos('api_base_url', S) = 1 then
    begin
      P := Pos('"', S);
      if P > 0 then
      begin
        S := Copy(S, P + 1, Length(S));
        P := Pos('"', S);
        if P > 0 then Result := Copy(S, 1, P - 1);
      end;
      Exit;
    end;
  end;
end;

function ServerUrl: String;
begin
  Result := Trim(ServerPage.Values[0]);
  while (Length(Result) > 0) and (Result[Length(Result)] = '/') do
    Delete(Result, Length(Result), 1);
end;

function ConsoleUrl(Param: String): String;
begin
  Result := ServerUrl + '/web/camera-discovery';
end;

function StripQuotes(const S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '"', '', True);
  Result := Trim(Result);
end;

function ValidCode(const S: String): Boolean;
var
  I: Integer;
  C: Char;
begin
  Result := (Length(S) >= 8) and (Length(S) <= 32);
  for I := 1 to Length(S) do
  begin
    C := S[I];
    if not (((C >= 'A') and (C <= 'Z')) or ((C >= 'a') and (C <= 'z')) or ((C >= '0') and (C <= '9')) or (C = '-')) then
      Result := False;
  end;
end;

function InitializeSetup: Boolean;
begin
  Upgrading := RegQueryStringValue(HKLM64, UninstallKey, 'DisplayVersion', PrevVersion);
  Result := True;
end;

procedure PairLaterClick(Sender: TObject);
begin
  ConnectPage.Edits[0].Enabled := not PairLaterBox.Checked;
  ConnectPage.Edits[1].Enabled := not PairLaterBox.Checked;
end;

procedure InitializeWizard;
var
  Server, Name: String;
begin
  DownloadPage := CreateDownloadPage(CustomMessage('DownloadTitle'), CustomMessage('DownloadSubtitle'), @OnDownloadProgress);
  if Upgrading then
    WizardForm.WelcomeLabel2.Caption := FmtMessage(CustomMessage('UpdateWelcome'), [PrevVersion, '{#AppVersion}']);

  ServerPage := CreateInputQueryPage(wpLicense, CustomMessage('ServerTitle'), CustomMessage('ServerSubtitle'),
    CustomMessage('ServerIntro'));
  ServerPage.Add(CustomMessage('ServerLabel'), False);
  Server := ConfiguredServer;
  if Server = '' then Server := ExpandConstant('{param:SERVER|}');
  if Server = '' then Server := '{#DefaultServer}';
  ServerPage.Values[0] := Server;

  { Shown after the files are installed: pairing needs the installed agent. }
  ConnectPage := CreateInputQueryPage(wpInstalling, CustomMessage('ConnectTitle'), CustomMessage('ConnectSubtitle'),
    CustomMessage('ConnectIntro'));
  ConnectPage.Add(CustomMessage('CodeLabel'), False);
  ConnectPage.Add(CustomMessage('NameLabel'), False);
  ConnectPage.Values[0] := ExpandConstant('{param:CODE|}');
  Name := ExpandConstant('{param:NAME|}');
  if Name = '' then Name := GetComputerNameString;
  ConnectPage.Values[1] := Name;

  PairLaterBox := TNewCheckBox.Create(ConnectPage);
  PairLaterBox.Parent := ConnectPage.Surface;
  PairLaterBox.Top := ConnectPage.Edits[1].Top + ConnectPage.Edits[1].Height + ScaleY(16);
  PairLaterBox.Width := ConnectPage.SurfaceWidth;
  PairLaterBox.Height := ScaleY(20);
  PairLaterBox.Caption := CustomMessage('PairLater');
  PairLaterBox.OnClick := @PairLaterClick;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if Upgrading and ((PageID = wpLicense) or ((PageID = ServerPage.ID) and (ConfiguredServer <> ''))) then
    Result := True;
  if (PageID = ConnectPage.ID) and (SetupFailed or IsPaired) then
    Result := True;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo,
  MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := CustomMessage('ReadyServer') + NewLine + Space + ServerUrl + NewLine;
  if Upgrading then
    Result := Result + NewLine + FmtMessage(CustomMessage('ReadyMode'), [PrevVersion, '{#AppVersion}']) + NewLine +
      Space + CustomMessage('ReadyKeep') + NewLine;
end;

function Quoted(const S: String): String;
begin
  Result := '"' + S + '"';
end;

{ Runs `cmd /S /C "<line>"` hidden; output is appended to the setup log. }
function RunHidden(const Line: String; var Code: Integer): Boolean;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/S /C "' + Line + '"', ExpandConstant('{app}'), SW_HIDE,
    ewWaitUntilTerminated, Code);
end;

function RunPhase(const Phase, MsgName, Extra: String; Index, Count: Integer): Boolean;
var
  Code: Integer;
  Line: String;
begin
  WizardForm.StatusLabel.Caption := CustomMessage(MsgName);
  WizardForm.FilenameLabel.Caption := FmtMessage(CustomMessage('StepOf'), [IntToStr(Index), IntToStr(Count)]);
  { Windows PowerShell 5.1 must not inherit a PowerShell 7 module path (setup started from pwsh). }
  Line := 'set "PSModulePath=" && ' + Quoted(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe')) +
    ' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + Quoted(ExpandConstant('{app}\deploy\install-windows.ps1')) +
    ' -Api ' + Quoted(ServerUrl) + ' -Phase ' + Phase + Extra + ' >> ' + Quoted(SetupLog) + ' 2>&1';
  Log('Phase ' + Phase);
  Result := RunHidden(Line, Code) and (Code = 0);
  if not Result then
  begin
    FailureText := CustomMessage(MsgName);
    Log(Format('Phase %s failed with exit code %d', [Phase, Code]));
  end;
end;

procedure StopAgent;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN ' + Quoted(TaskName), '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM retailguard-edge.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopAgent;  // the running agent holds files under the install folder open
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Phases, Msgs: TArrayOfString;
  I: Integer;
  Extra: String;
begin
  if CurStep <> ssPostInstall then Exit;
  ForceDirectories(DataDir + '\logs');
  SaveStringToFile(SetupLog, #13#10 + '==== RetailGuard Edge {#AppVersion} setup ' + GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + #13#10, True);
  SetArrayLength(Phases, 6);
  SetArrayLength(Msgs, 6);
  Phases[0] := 'Prepare';      Msgs[0] := 'StepPrepare';
  Phases[1] := 'Runtime';      Msgs[1] := 'StepRuntime';
  Phases[2] := 'Dependencies'; Msgs[2] := 'StepDependencies';
  Phases[3] := 'Ffmpeg';       Msgs[3] := 'StepFfmpeg';
  Phases[4] := 'Configure';    Msgs[4] := 'StepConfigure';
  Phases[5] := 'Service';      Msgs[5] := 'StepService';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  for I := 0 to GetArrayLength(Phases) - 1 do
  begin
    Extra := '';
    if (Phases[I] = 'Ffmpeg') and FfmpegDownloaded then Extra := ' -FfmpegZip ' + Quoted(FfmpegZip);
    if not RunPhase(Phases[I], Msgs[I], Extra, I + 1, GetArrayLength(Phases)) then
    begin
      SetupFailed := True;
      Break;
    end;
  end;
  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Max;
  if SetupFailed then
    SuppressibleMsgBox(FmtMessage(CustomMessage('PhaseFailed'), [FailureText, SetupLog]), mbError, MB_OK, IDOK);
end;

{ Pairs with the store; on failure returns a message for the user. }
function Pair(const PairCode, Name: String; var Msg: String): Boolean;
var
  Code: Integer;
  OutFile, Line: String;
  Text: AnsiString;
begin
  OutFile := ExpandConstant('{tmp}\pair.txt');
  DeleteFile(OutFile);
  Line := Quoted(AgentExe) + ' --config ' + Quoted(ConfigFile) + ' --state-dir ' + Quoted(StateDir) +
    ' pair --api ' + Quoted(ServerUrl) + ' --code ' + Quoted(PairCode) + ' --name ' + Quoted(Name) +
    ' > ' + Quoted(OutFile) + ' 2>&1';
  Result := RunHidden(Line, Code) and (Code = 0);
  Msg := '';
  if LoadStringFromFile(OutFile, Text) then Msg := Trim(String(Text));
  Log('pair exit ' + IntToStr(Code));
  if not Result then
  begin
    if (Pos('invalid_pairing_code', Msg) > 0) or (Pos('HTTP 401', Msg) > 0) or (Pos('HTTP 410', Msg) > 0) then
      Msg := CustomMessage('PairRejected')
    else if (Pos('ConnectError', Msg) > 0) or (Pos('unreachable', Msg) > 0) or (Pos('timed out', Msg) > 0) then
      Msg := CustomMessage('PairUnreachable')
    else
      Msg := FmtMessage(CustomMessage('PairFailed'), [Msg]);
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Url, PairCode, Name, Msg: String;
  Code: Integer;
begin
  Result := True;
  if (CurPageID = wpReady) and not FfmpegPresent and not FfmpegDownloaded then
  begin
    { Download with a visible progress bar before anything is changed; verified by SHA-256. }
    DownloadPage.Clear;
    DownloadPage.Add('{#FfmpegUrl}', 'ffmpeg.zip', '{#FfmpegSha256}');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
        FfmpegDownloaded := True;
      except
        if not DownloadPage.AbortedByUser then
          SuppressibleMsgBox(FmtMessage(CustomMessage('DownloadFailed'), [GetExceptionMessage]), mbError, MB_OK, IDOK);
        Result := False;
      end;
    finally
      DownloadPage.Hide;
    end;
  end
  else if CurPageID = ServerPage.ID then
  begin
    Url := ServerUrl;
    if (Pos('https://', Lowercase(Url)) <> 1) or (Length(Url) < 12) or (Pos(' ', Url) > 0) then
    begin
      SuppressibleMsgBox(CustomMessage('ServerInvalid'), mbError, MB_OK, IDOK);
      Result := False;
    end;
  end
  else if CurPageID = ConnectPage.ID then
  begin
    PairCode := StripQuotes(ConnectPage.Values[0]);
    Name := StripQuotes(ConnectPage.Values[1]);
    if PairLaterBox.Checked or (WizardSilent and (PairCode = '')) then Exit;
    if not ValidCode(PairCode) then
    begin
      SuppressibleMsgBox(CustomMessage('CodeInvalid'), mbError, MB_OK, IDOK);
      Result := WizardSilent;
      Exit;
    end;
    if Name = '' then
    begin
      SuppressibleMsgBox(CustomMessage('NameInvalid'), mbError, MB_OK, IDOK);
      Result := WizardSilent;
      Exit;
    end;
    WizardForm.NextButton.Enabled := False;
    try
      if Pair(PairCode, Name, Msg) then
      begin
        PairedNow := True;
        Exec(ExpandConstant('{sys}\schtasks.exe'), '/Run /TN ' + Quoted(TaskName), '', SW_HIDE, ewWaitUntilTerminated, Code);
      end
      else
      begin
        Log('pairing failed: ' + Msg);
        SuppressibleMsgBox(Msg, mbError, MB_OK, IDOK);
        { Stay on the page so another code can be entered (silent installs continue unpaired). }
        Result := WizardSilent;
      end;
    finally
      WizardForm.NextButton.Enabled := True;
    end;
  end;
end;

{ Silent/scripted installs see a failed step as a non-zero exit code. }
function GetCustomSetupExitCode: Integer;
begin
  if SetupFailed then Result := 10 else Result := 0;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpReady) and Upgrading then
  begin
    WizardForm.NextButton.Caption := CustomMessage('UpdateButton');
    WizardForm.PageNameLabel.Caption := CustomMessage('ReadyUpdateTitle');
    WizardForm.PageDescriptionLabel.Caption := CustomMessage('ReadyUpdateSubtitle');
    WizardForm.ReadyLabel.Caption := CustomMessage('ReadyUpdateText');
  end;
  if CurPageID = wpFinished then
  begin
    if SetupFailed then
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('DoneFailed'), [FailureText, SetupLog])
    else if IsPaired then
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('DoneConnected'), ['{#AppVersion}'])
    else
      WizardForm.FinishedLabel.Caption := FmtMessage(CustomMessage('DoneNotPaired'), ['{#AppVersion}']);
  end;
end;

procedure RemoveFromPath(const Dir: String);
var
  Path: String;
  P: Integer;
begin
  if not RegQueryStringValue(HKLM64, EnvKey, 'Path', Path) then Exit;
  P := Pos(';' + Uppercase(Dir), Uppercase(Path));
  if P = 0 then Exit;
  Delete(Path, P, Length(Dir) + 1);
  RegWriteExpandStringValue(HKLM64, EnvKey, 'Path', Path);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    StopAgent;
    Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN ' + Quoted(TaskName) + ' /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
    RemoveFromPath(ExpandConstant('{app}\bin'));
  end;
  if CurUninstallStep = usPostUninstall then
    if SuppressibleMsgBox(CustomMessage('RemoveDataAsk'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
      DelTree(DataDir, True, True, True);
end;
