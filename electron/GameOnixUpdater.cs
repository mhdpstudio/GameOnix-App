using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

internal sealed class GameOnixUpdater : Form
{
    private readonly string archivePath;
    private readonly string installDirectory;
    private readonly string executablePath;
    private readonly int parentPid;
    private readonly string version;
    private readonly string lockPath;
    private readonly string logPath;
    private readonly string updaterCopyPath;
    private readonly Label statusLabel;
    private readonly Label detailLabel;
    private readonly ProgressBar progressBar;
    private readonly BackgroundWorker worker;
    private string stageDirectory;

    private GameOnixUpdater(string[] args)
    {
        archivePath = args[0];
        installDirectory = args[1];
        executablePath = args[2];
        parentPid = Int32.Parse(args[3]);
        version = args[4];
        lockPath = args[5];
        logPath = args[6];
        updaterCopyPath = args[7];

        Text = "GameOnix Update Installer";
        Width = 510;
        Height = 205;
        MinimumSize = new Size(510, 205);
        MaximumSize = new Size(510, 205);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        BackColor = Color.FromArgb(17, 16, 23);
        ForeColor = Color.FromArgb(244, 240, 255);
        Font = new Font("Segoe UI", 9F, FontStyle.Regular);

        var title = new Label();
        title.Text = "Installing GameOnix " + version;
        title.Font = new Font("Segoe UI Semibold", 15F, FontStyle.Bold);
        title.ForeColor = Color.FromArgb(233, 224, 255);
        title.AutoSize = false;
        title.SetBounds(24, 20, 450, 30);
        Controls.Add(title);

        statusLabel = new Label();
        statusLabel.Text = "Starting installer…";
        statusLabel.AutoSize = false;
        statusLabel.SetBounds(25, 65, 450, 22);
        Controls.Add(statusLabel);

        progressBar = new ProgressBar();
        progressBar.Minimum = 0;
        progressBar.Maximum = 100;
        progressBar.Value = 0;
        progressBar.Style = ProgressBarStyle.Continuous;
        progressBar.SetBounds(25, 95, 450, 16);
        Controls.Add(progressBar);

        detailLabel = new Label();
        detailLabel.Text = "Keep this window open; GameOnix will reopen after verification.";
        detailLabel.ForeColor = Color.FromArgb(161, 153, 178);
        detailLabel.AutoSize = false;
        detailLabel.SetBounds(25, 123, 450, 34);
        Controls.Add(detailLabel);

        worker = new BackgroundWorker();
        worker.WorkerReportsProgress = true;
        worker.DoWork += InstallUpdate;
        worker.ProgressChanged += OnProgressChanged;
        worker.RunWorkerCompleted += OnInstallCompleted;
        Shown += delegate { worker.RunWorkerAsync(); };
        FormClosing += delegate(object sender, FormClosingEventArgs e)
        {
            if (worker.IsBusy) e.Cancel = true;
        };
    }

    [STAThread]
    private static void Main(string[] args)
    {
        if (args == null || args.Length < 8)
        {
            MessageBox.Show("The update installer did not receive all required paths.", "GameOnix Update Installer", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new GameOnixUpdater(args));
    }

    private void InstallUpdate(object sender, DoWorkEventArgs e)
    {
        bool installed = false;
        FileStream updateLock = null;
        try
        {
            updateLock = new FileStream(lockPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            WaitForGameOnixToClose();
            stageDirectory = Path.Combine(Path.GetTempPath(), "GameOnix-update-" + version + "-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stageDirectory);
            ExtractArchive();
            CopyUpdatedFiles();
            VerifyInstalledFiles();
            Report(98, "Update files are installed and verified.");
            WriteLog("Update " + version + " verified in the app folder.");
            installed = true;
        }
        catch (Exception ex)
        {
            WriteLog("Update failed: " + ex.ToString());
            e.Result = ex;
            return;
        }
        finally
        {
            try { if (stageDirectory != null && Directory.Exists(stageDirectory)) Directory.Delete(stageDirectory, true); } catch (Exception ex) { WriteLog("Could not remove staging folder: " + ex.Message); }
            try { if (updateLock != null) updateLock.Dispose(); } catch { }
            try { if (File.Exists(lockPath)) File.Delete(lockPath); } catch (Exception ex) { WriteLog("Could not remove update lock: " + ex.Message); }
        }

        if (installed)
        {
            try
            {
                string updateDirectory = Path.GetDirectoryName(archivePath);
                try { if (File.Exists(archivePath)) File.Delete(archivePath); } catch { }
                try { if (File.Exists(archivePath + ".partial")) File.Delete(archivePath + ".partial"); } catch { }
                try { if (File.Exists(archivePath + ".sha256")) File.Delete(archivePath + ".sha256"); } catch { }
                try { if (Directory.Exists(updateDirectory)) Directory.Delete(updateDirectory, true); } catch (Exception ex) { WriteLog("Could not remove update cache: " + ex.Message); }
                Report(100, "Installation complete. Opening GameOnix…");
                WriteLog("Starting GameOnix " + version + " after installer verification.");
                Process.Start(new ProcessStartInfo(executablePath) { WorkingDirectory = installDirectory, UseShellExecute = true });
                e.Result = null;
            }
            catch (Exception ex)
            {
                WriteLog("Update installed, but GameOnix could not be opened: " + ex.ToString());
                e.Result = ex;
            }
        }
    }

    private void WaitForGameOnixToClose()
    {
        DateTime start = DateTime.UtcNow;
        DateTime deadline = start.AddMinutes(2);
        while (DateTime.UtcNow < deadline)
        {
            bool parentRunning = false;
            try
            {
                using (Process parent = Process.GetProcessById(parentPid)) parentRunning = !parent.HasExited;
            }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }

            bool appRunning = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(executablePath))
                .Any(process => IsGameOnixProcess(process, executablePath));
            if (!parentRunning && !appRunning) return;

            int elapsedSeconds = (int)(DateTime.UtcNow - start).TotalSeconds;
            int percent = Math.Min(18, 3 + elapsedSeconds / 8);
            Report(percent, "Waiting for GameOnix and its background tasks to close…");
            Thread.Sleep(350);
        }
        throw new TimeoutException("GameOnix did not close in time. Close it from the system tray, then try the update again.");
    }

    private static bool IsGameOnixProcess(Process process, string executable)
    {
        try
        {
            string actual = process.MainModule.FileName;
            return String.Equals(Path.GetFullPath(actual), Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
        finally { process.Dispose(); }
    }

    private void ExtractArchive()
    {
        Report(20, "Extracting the update archive…");
        using (FileStream input = File.OpenRead(archivePath))
        using (ZipArchive archive = new ZipArchive(input, ZipArchiveMode.Read))
        {
            long total = archive.Entries.Sum(entry => entry.Length);
            long completed = 0;
            DateTime lastReport = DateTime.MinValue;
            string root = Path.GetFullPath(stageDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            byte[] buffer = new byte[1024 * 256];
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                string target = Path.GetFullPath(Path.Combine(stageDirectory, relative));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The update archive contains an invalid file path.");
                if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\"))
                {
                    Directory.CreateDirectory(target);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream source = entry.Open())
                using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    int count;
                    while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, count);
                        completed += count;
                        if ((DateTime.UtcNow - lastReport).TotalMilliseconds > 150)
                        {
                            int percent = total <= 0 ? 39 : 20 + (int)(19L * completed / total);
                            Report(percent, "Extracting update archive…");
                            lastReport = DateTime.UtcNow;
                        }
                    }
                }
            }
        }
        Report(40, "Update files extracted.");
        WriteLog("Update archive extracted.");
    }

    private void CopyUpdatedFiles()
    {
        Report(42, "Copying updated files into the GameOnix folder…");
        string[] files = Directory.GetFiles(stageDirectory, "*", SearchOption.AllDirectories);
        long total = files.Sum(file => new FileInfo(file).Length);
        long completed = 0;
        DateTime lastReport = DateTime.MinValue;
        byte[] buffer = new byte[1024 * 256];
        foreach (string sourcePath in files)
        {
            string relative = sourcePath.Substring(stageDirectory.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (String.Equals(relative, "GameOnixUpdater.exe", StringComparison.OrdinalIgnoreCase)) continue;
            string destination = Path.Combine(installDirectory, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using (FileStream source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (FileStream output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                int count;
                while ((count = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    output.Write(buffer, 0, count);
                    completed += count;
                    if ((DateTime.UtcNow - lastReport).TotalMilliseconds > 150)
                    {
                        int percent = total <= 0 ? 87 : 42 + (int)(45L * completed / total);
                        Report(percent, "Copying updated files into the GameOnix folder…");
                        lastReport = DateTime.UtcNow;
                    }
                }
            }
        }
        Report(88, "Updated files copied.");
        WriteLog("Updated files copied into " + installDirectory + ".");
    }

    private void VerifyInstalledFiles()
    {
        Report(90, "Verifying the installed application…");
        string[] required = { "GameOnix.exe", Path.Combine("resources", "app.asar") };
        foreach (string relative in required)
        {
            string source = Path.Combine(stageDirectory, relative);
            string installed = Path.Combine(installDirectory, relative);
            if (!File.Exists(source) || !File.Exists(installed)) throw new FileNotFoundException("Update verification could not find " + relative + ".");
            if (!String.Equals(Sha256(source), Sha256(installed), StringComparison.OrdinalIgnoreCase))
                throw new IOException("The installed " + relative + " file does not match the update archive.");
        }
        Report(97, "Installed files verified.");
        WriteLog("Installed executable and app archive hashes verified.");
    }

    private static string Sha256(string path)
    {
        using (SHA256 hash = SHA256.Create())
        using (FileStream stream = File.OpenRead(path))
            return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "");
    }

    private void Report(int percent, string message)
    {
        worker.ReportProgress(Math.Max(0, Math.Min(100, percent)), message);
    }

    private void OnProgressChanged(object sender, ProgressChangedEventArgs e)
    {
        progressBar.Value = e.ProgressPercentage;
        statusLabel.Text = Convert.ToString(e.UserState);
        detailLabel.Text = e.ProgressPercentage.ToString() + "% complete";
    }

    private void OnInstallCompleted(object sender, RunWorkerCompletedEventArgs e)
    {
        if (e.Error != null || (e.Result is Exception))
        {
            Exception error = e.Error ?? (Exception)e.Result;
            statusLabel.Text = "The update could not be installed.";
            detailLabel.Text = error.Message;
            detailLabel.ForeColor = Color.FromArgb(255, 145, 145);
            progressBar.ForeColor = Color.FromArgb(220, 75, 95);
            MinimizeBox = false;
            var close = new Button();
            close.Text = "Close";
            close.SetBounds(382, 145, 92, 28);
            close.Click += delegate { Close(); };
            Controls.Add(close);
            close.BringToFront();
            return;
        }
        Close();
    }

    private void WriteLog(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            File.AppendAllText(logPath, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine);
        }
        catch { }
    }
}
