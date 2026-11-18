import { spawn, type ChildProcess } from "node:child_process";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const WINDOWS_PROMPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BARBORA_CONFIRM))
$form = New-Object System.Windows.Forms.Form
$form.Text = "Place this Barbora order?"
$form.Width = 480
$form.Height = 360
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Topmost = $true
$box = New-Object System.Windows.Forms.TextBox
$box.Left = 16
$box.Top = 16
$box.Width = 430
$box.Height = 240
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = "Vertical"
$box.Text = $text
$ok = New-Object System.Windows.Forms.Button
$ok.Text = "Place order"
$ok.Left = 230
$ok.Top = 270
$ok.Width = 100
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Left = 340
$cancel.Top = 270
$cancel.Width = 100
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.AcceptButton = $ok
$form.CancelButton = $cancel
$form.Controls.AddRange(@($box, $ok, $cancel))
$result = $form.ShowDialog()
$box.Text = ""
$form.Dispose()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
exit 0
`.trim();

export async function promptToPlace(message: string): Promise<boolean> {
  if (process.platform === "win32") return promptOnWindows(message);
  return promptOnTTY(message);
}

function promptOnWindows(message: string): Promise<boolean> {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  const powershell = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const child = spawn(
    powershell,
    ["-NoProfile", "-STA", "-NoLogo", "-WindowStyle", "Hidden", "-Command", "-"],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: { ...process.env, BARBORA_CONFIRM: Buffer.from(message, "utf8").toString("base64") },
    },
  );
  child.stdin?.write(WINDOWS_PROMPT);
  child.stdin?.end();
  return readAnswer(child);
}

function promptOnTTY(message: string): Promise<boolean> {
  const child = spawn(
    "bash",
    [
      "-c",
      'printf "%s\\nPlace this order? [y/N] " "$1" >/dev/tty; IFS= read -r answer </dev/tty || exit 1; case "$answer" in y|Y) exit 0 ;; *) exit 1 ;; esac',
      "bash",
      message,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return readAnswer(child);
}

function readAnswer(child: ChildProcess): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill(), FIVE_MINUTES_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
