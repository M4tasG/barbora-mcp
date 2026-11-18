import { spawn, type ChildProcess } from "node:child_process";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const WINDOWS_PROMPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = "Barbora password"
$form.Width = 420
$form.Height = 170
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Topmost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = "Type the Barbora password. It stays on this machine."
$label.Left = 16
$label.Top = 16
$label.Width = 370
$box = New-Object System.Windows.Forms.TextBox
$box.Left = 16
$box.Top = 48
$box.Width = 370
$box.UseSystemPasswordChar = $true
$ok = New-Object System.Windows.Forms.Button
$ok.Text = "Sign in"
$ok.Left = 200
$ok.Top = 88
$ok.Width = 80
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Left = 290
$cancel.Top = 88
$cancel.Width = 80
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.AcceptButton = $ok
$form.CancelButton = $cancel
$form.Controls.AddRange(@($label, $box, $ok, $cancel))
$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($box.Text)
$box.Text = ""
$stream = [Console]::OpenStandardOutput()
$stream.Write($bytes, 0, $bytes.Length)
$stream.Flush()
$form.Dispose()
exit 0
`.trim();

export async function promptForPassword(): Promise<string | null> {
  if (process.platform === "win32") return promptOnWindows();
  return promptOnTTY();
}

function promptOnWindows(): Promise<string | null> {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  const powershell = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const child = spawn(
    powershell,
    ["-NoProfile", "-STA", "-NoLogo", "-WindowStyle", "Hidden", "-Command", "-"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false },
  );
  child.stdin?.write(WINDOWS_PROMPT);
  child.stdin?.end();
  return readPrompt(child);
}

function promptOnTTY(): Promise<string | null> {
  const child = spawn(
    "bash",
    [
      "-c",
      'printf %s "Barbora password: " >/dev/tty; IFS= read -r -s password </dev/tty || exit 1; printf "\\n" >/dev/tty; printf %s "$password"',
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return readPrompt(child);
}

function readPrompt(child: ChildProcess): Promise<string | null> {
  const stdout = child.stdout;
  if (!stdout) return Promise.reject(new Error("The password prompt failed."));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), FIVE_MINUTES_MS);
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString("utf8"));
        return;
      }
      resolve(null);
    });
  });
}
