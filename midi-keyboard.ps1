$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PianoBlindTrainerMidiKeyboard
{
    public static class Program
    {
        private static Mutex singleInstance;
        private const int SW_RESTORE = 9;

        [STAThread]
        public static int Main(string[] args)
        {
            string statusFile = ArgumentValue(args, "--status");
            string logFile = ArgumentValue(args, "--log");
            string bridgeUrl = ArgumentValue(args, "--bridge");
            string bridgeToken = ArgumentValue(args, "--bridge-token");
            SignalStatus(statusFile, "STARTING:EXE запущен, создаю Windows-окно.");
            try
            {
                Run(statusFile, bridgeUrl, bridgeToken);
                return 0;
            }
            catch (Exception error)
            {
                SignalError(statusFile, logFile, error);
                try
                {
                    MessageBox.Show(
                        "Не удалось запустить режим «Пианино → клавиатура ПК».\r\n\r\n" + error,
                        "Piano Blind Trainer",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                }
                catch { }
                return 1;
            }
        }

        private static string ArgumentValue(string[] args, string name)
        {
            if (args == null) return String.Empty;
            for (int index = 0; index + 1 < args.Length; index++)
            {
                if (String.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1] ?? String.Empty;
            }
            return String.Empty;
        }

        private static void SignalStatus(string statusFile, string value)
        {
            if (String.IsNullOrWhiteSpace(statusFile)) return;
            try { File.WriteAllText(statusFile, value, new UTF8Encoding(false)); }
            catch { }
        }

        private static void SignalError(string statusFile, string logFile, Exception error)
        {
            string details = error == null ? "Неизвестная ошибка." : error.ToString();
            if (!String.IsNullOrWhiteSpace(logFile))
            {
                try { File.WriteAllText(logFile, details, new UTF8Encoding(false)); }
                catch { }
            }
            string shortMessage = error == null ? "Неизвестная ошибка." : error.Message;
            SignalStatus(statusFile, "ERROR:" + shortMessage.Replace("\r", " ").Replace("\n", " "));
        }

        public static void Run(string statusFile)
        {
            Run(statusFile, String.Empty, String.Empty);
        }

        public static void Run(string statusFile, string bridgeUrl, string bridgeToken)
        {
            bool createdNew;
            singleInstance = new Mutex(true, "PianoBlindTrainerMidiKeyboardV226", out createdNew);
            if (!createdNew)
            {
                IntPtr existingWindow = FindWindow(null, "Пианино → клавиатура ПК · v22.6");
                if (existingWindow != IntPtr.Zero)
                {
                    ShowWindow(existingWindow, SW_RESTORE);
                    SetForegroundWindow(existingWindow);
                }
                singleInstance.Dispose();
                if (existingWindow == IntPtr.Zero) throw new InvalidOperationException("Программа уже отмечена как запущенная, но её окно не найдено. Закрой оставшийся процесс PianoBlindTrainerMidiKeyboard в Диспетчере задач и повтори запуск.");
                SignalReady(statusFile, "Программа уже была запущена — её окно выведено вперёд.");
                return;
            }

            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var form = new MainForm(bridgeUrl, bridgeToken);
                form.Shown += delegate { SignalReady(statusFile, "Окно MIDI-клавиатуры действительно открыто на этом ПК."); };
                Application.Run(form);
            }
            finally
            {
                singleInstance.ReleaseMutex();
                singleInstance.Dispose();
            }
        }

        private static void SignalReady(string statusFile, string message)
        {
            if (String.IsNullOrWhiteSpace(statusFile)) return;
            try
            {
                File.WriteAllText(statusFile, "READY:" + message, new UTF8Encoding(false));
            }
            catch { }
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);
    }

    public sealed class MainForm : Form
    {
        private const uint CALLBACK_FUNCTION = 0x00030000;
        private const uint MIM_DATA = 0x3C3;
        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_ALT = 0x12;
        private const ushort VK_TAB = 0x09;
        private const ushort VK_RMENU = 0xA5;
        private const ushort VK_BACK = 0x08;
        private const ushort VK_RETURN = 0x0D;
        private const ushort VK_SPACE = 0x20;
        private const int BACKSPACE_REPEAT_DELAY = 360;
        private const int BACKSPACE_REPEAT_INTERVAL = 45;

        private const string ACTION_BACKSPACE_ONE = "backspace-one";
        private const string ACTION_BACKSPACE_TWO = "backspace-two";
        private const string ACTION_CONTROL = "control";
        private const string ACTION_TAB = "tab";
        private const string ACTION_ALT = "alt";
        private const string ACTION_RIGHT_ALT = "right-alt";
        private const string ACTION_ENTER = "enter";
        private const string ACTION_OVERLAY = "overlay";
        private const string ACTION_SPACE = "space";

        private readonly ComboBox deviceBox = new WheelLockedComboBox();
        private readonly Button refreshButton = new Button();
        private readonly Button toggleButton = new Button();
        private readonly Label statusLabel = new Label();
        private readonly NumericUpDown backspaceOne = new WheelLockedNumericUpDown();
        private readonly NumericUpDown backspaceTwo = new WheelLockedNumericUpDown();
        private readonly NumericUpDown controlNote = new WheelLockedNumericUpDown();
        private readonly NumericUpDown tabNote = new WheelLockedNumericUpDown();
        private readonly NumericUpDown altNote = new WheelLockedNumericUpDown();
        private readonly NumericUpDown rightAltNote = new WheelLockedNumericUpDown();
        private readonly NumericUpDown enterNote = new WheelLockedNumericUpDown();
        private readonly NumericUpDown overlayNote = new WheelLockedNumericUpDown();
        private readonly NumericUpDown spaceNote = new WheelLockedNumericUpDown();
        private readonly Button learnOneButton = new Button();
        private readonly Button learnTwoButton = new Button();
        private readonly Button learnControlButton = new Button();
        private readonly Button learnTabButton = new Button();
        private readonly Button learnAltButton = new Button();
        private readonly Button learnRightAltButton = new Button();
        private readonly Button learnEnterButton = new Button();
        private readonly Button learnOverlayButton = new Button();
        private readonly Button learnSpaceButton = new Button();
        private readonly Button overlayPreviewButton = new Button();
        private readonly TrackBar overlayOpacityBar = new WheelLockedTrackBar();
        private readonly Label overlayOpacityValue = new Label();
        private readonly TrackBar overlayVerticalBar = new WheelLockedTrackBar();
        private readonly Label overlayVerticalValue = new Label();
        private readonly CheckBox overlaySymbolsOnlyCheck = new CheckBox();
        private readonly CheckBox overlayWhiteNotesCheck = new CheckBox();
        private readonly CheckBox overlayBlackNotesCheck = new CheckBox();
        private readonly CheckBox overlayQwertyBottomCheck = new CheckBox();
        private readonly ComboBox overlayContrastBox = new WheelLockedComboBox();
        private readonly Label keyboardLayoutLabel = new Label();
        private readonly Button editMappingButton = new Button();
        private readonly Button resetSettingsButton = new Button();
        private readonly TextBox mappingBox = new TextBox();
        private readonly Label lastNoteLabel = new Label();
        private readonly Panel settingsScrollPanel = new Panel();
        private readonly System.Windows.Forms.Timer backspaceRepeatTimer = new System.Windows.Forms.Timer();
        private readonly System.Windows.Forms.Timer keyboardLayoutTimer = new System.Windows.Forms.Timer();

        private readonly Dictionary<int, KeyStroke> map = CreateMap();
        private readonly Dictionary<string, string> savedSettings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly string bridgeUrl;
        private readonly string bridgeToken;
        private readonly string settingsPath;
        private readonly Queue<string> bridgeQueue = new Queue<string>();
        private readonly object bridgeQueueLock = new object();
        private readonly HashSet<int> pressedMidiNotes = new HashSet<int>();
        private readonly HashSet<int> heldBackspaceNotes = new HashSet<int>();
        private bool bridgeWorkerRunning = false;
        private System.Threading.Timer bridgeHeartbeat;
        private IntPtr midiHandle = IntPtr.Zero;
        private MidiInProc midiCallback;
        private string learningAction = String.Empty;
        private int heldControlNote = -1;
        private int heldAltNote = -1;
        private int heldRightAltNote = -1;
        private IntPtr activeKeyboardLayout = IntPtr.Zero;
        private ushort activeKeyboardLanguage = 0x0409;
        private bool applyingSettings = false;
        private PianoOverlayForm overlayForm;
        private bool closing = false;

        public MainForm(string bridgeEventUrl, string bridgeAccessToken)
        {
            bridgeUrl = bridgeEventUrl ?? String.Empty;
            bridgeToken = bridgeAccessToken ?? String.Empty;
            settingsPath = Path.Combine(Environment.CurrentDirectory, "midi-keyboard-settings.ini");
            LoadSettingsFile();
            ApplySavedMapping();
            Text = "Пианино → клавиатура ПК · v22.6";
            StartPosition = FormStartPosition.CenterScreen;
            Rectangle working = Screen.PrimaryScreen.WorkingArea;
            MinimumSize = new Size(760, Math.Min(620, Math.Max(520, working.Height - 30)));
            Size = new Size(Math.Min(920, Math.Max(760, working.Width - 40)), Math.Min(850, Math.Max(560, working.Height - 40)));
            BackColor = Color.FromArgb(8, 18, 35);
            ForeColor = Color.FromArgb(238, 247, 255);
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            FormClosing += OnFormClosing;
            Shown += delegate { PostBridgeWindow(true); StartBridgeHeartbeat(); };

            BuildInterface();
            InitializeBehaviorTimers();
            UpdateActiveKeyboardLayout(true);
            RefreshDevices();
        }

        private void BuildInterface()
        {
            settingsScrollPanel.Dock = DockStyle.Fill;
            settingsScrollPanel.AutoScroll = true;
            settingsScrollPanel.BackColor = BackColor;
            ConnectWheelLockedScrolling();
            Controls.Add(settingsScrollPanel);

            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(18),
                ColumnCount = 1,
                RowCount = 7,
                BackColor = BackColor
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            settingsScrollPanel.Controls.Add(root);

            var title = new Label
            {
                AutoSize = true,
                Text = "Пианино как обычная клавиатура Windows",
                Font = new Font("Segoe UI", 18F, FontStyle.Bold),
                ForeColor = Color.FromArgb(238, 247, 255),
                Margin = new Padding(0, 0, 0, 6)
            };
            root.Controls.Add(title, 0, 0);

            var description = new Label
            {
                AutoSize = true,
                MaximumSize = new Size(760, 0),
                Text = "После запуска нажатия MIDI-клавиш отправляются в активную программу — браузер, блокнот, чат или редактор, а музыкальные ноты одновременно возвращаются в урок через локальный MIDI-мост. Исходная раскладка совпадает с виртуальным пианино, её можно переназначить; экранные подписи автоматически следуют раскладке активного окна Windows.",
                ForeColor = Color.FromArgb(169, 189, 216),
                Margin = new Padding(0, 0, 0, 14)
            };
            root.Controls.Add(description, 0, 1);

            var deviceRow = new TableLayoutPanel
            {
                AutoSize = true,
                Dock = DockStyle.Top,
                ColumnCount = 3,
                Margin = new Padding(0, 0, 0, 12)
            };
            deviceRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            deviceRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            deviceRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            deviceBox.Dock = DockStyle.Fill;
            deviceBox.DropDownStyle = ComboBoxStyle.DropDownList;
            deviceBox.BackColor = Color.FromArgb(15, 32, 60);
            deviceBox.ForeColor = ForeColor;
            deviceBox.Margin = new Padding(0, 0, 8, 0);
            deviceRow.Controls.Add(deviceBox, 0, 0);

            refreshButton.Text = "Обновить";
            StyleSecondaryButton(refreshButton);
            refreshButton.Click += delegate { RefreshDevices(); };
            deviceRow.Controls.Add(refreshButton, 1, 0);

            toggleButton.Text = "Включить печать";
            StylePrimaryButton(toggleButton);
            toggleButton.Margin = new Padding(8, 0, 0, 0);
            toggleButton.Click += delegate { ToggleMidi(); };
            deviceRow.Controls.Add(toggleButton, 2, 0);
            root.Controls.Add(deviceRow, 0, 2);

            statusLabel.AutoSize = true;
            statusLabel.Text = "MIDI пока не запущен.";
            statusLabel.ForeColor = Color.FromArgb(251, 191, 36);
            statusLabel.Margin = new Padding(0, 0, 0, 12);
            root.Controls.Add(statusLabel, 0, 3);

            var actionGroup = new GroupBox
            {
                Text = "Свободные MIDI-клавиши для Space, Ctrl, Tab, Backspace, левого/правого Alt, Enter и экранной подсказки",
                Dock = DockStyle.Top,
                AutoSize = true,
                ForeColor = ForeColor,
                Padding = new Padding(12),
                Margin = new Padding(0, 0, 0, 12)
            };
            var actionLayout = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                ColumnCount = 4,
                RowCount = 18
            };
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 82));
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));

            AddActionRow(actionLayout, 0, "Space / пробел:", spaceNote, SettingInt("action.space", 33), learnSpaceButton, ACTION_SPACE);
            AddActionRow(actionLayout, 1, "Ctrl:", controlNote, SettingInt("action.control", 34), learnControlButton, ACTION_CONTROL);
            AddActionRow(actionLayout, 2, "Backspace слева:", backspaceOne, SettingInt("action.backspace-one", 35), learnOneButton, ACTION_BACKSPACE_ONE);
            AddActionRow(actionLayout, 3, "Backspace справа:", backspaceTwo, SettingInt("action.backspace-two", 97), learnTwoButton, ACTION_BACKSPACE_TWO);
            AddActionRow(actionLayout, 4, "Tab:", tabNote, SettingInt("action.tab", 31), learnTabButton, ACTION_TAB);
            AddActionRow(actionLayout, 5, "Alt слева:", altNote, SettingInt("action.alt", 32), learnAltButton, ACTION_ALT);
            AddActionRow(actionLayout, 6, "Alt справа (Right Alt):", rightAltNote, SettingInt("action.right-alt", 98), learnRightAltButton, ACTION_RIGHT_ALT);
            AddActionRow(actionLayout, 7, "Enter:", enterNote, SettingInt("action.enter", 99), learnEnterButton, ACTION_ENTER);
            AddActionRow(actionLayout, 8, "Показать / скрыть 88 клавиш:", overlayNote, SettingInt("action.overlay", 100), learnOverlayButton, ACTION_OVERLAY);

            var actionHint = new Label
            {
                AutoSize = true,
                MaximumSize = new Size(790, 0),
                Text = "По умолчанию: G1 = Tab, G#1 = левый Alt, A1 = Space, A#1 = Ctrl, B1/C#7 = Backspace, D7 = настоящий правый Alt, D#7 = Enter, E7 = показать/скрыть подсказку. Ctrl+Z: удерживай A#1 и нажми ноту с подписью z. Alt+Tab: удерживай G#1 и нажми G1.",
                ForeColor = Color.FromArgb(169, 189, 216),
                Margin = new Padding(0, 8, 0, 0)
            };
            actionLayout.Controls.Add(actionHint, 0, 9);
            actionLayout.SetColumnSpan(actionHint, 4);

            overlayPreviewButton.Text = "Показать / скрыть экранное пианино сейчас";
            StyleSecondaryButton(overlayPreviewButton);
            overlayPreviewButton.Margin = new Padding(0, 8, 0, 0);
            overlayPreviewButton.Click += delegate { ToggleOverlay(); };
            actionLayout.Controls.Add(overlayPreviewButton, 0, 10);
            actionLayout.SetColumnSpan(overlayPreviewButton, 4);

            actionLayout.Controls.Add(MakeLabel("Видимость подсказки:"), 0, 11);
            overlayOpacityBar.Minimum = 20;
            overlayOpacityBar.Maximum = 100;
            overlayOpacityBar.TickFrequency = 10;
            overlayOpacityBar.SmallChange = 2;
            overlayOpacityBar.LargeChange = 10;
            overlayOpacityBar.Value = Math.Max(20, Math.Min(100, SettingInt("overlay.opacity", 68)));
            overlayOpacityBar.AutoSize = false;
            overlayOpacityBar.Height = 34;
            overlayOpacityBar.Dock = DockStyle.Fill;
            overlayOpacityBar.BackColor = Color.FromArgb(8, 18, 35);
            overlayOpacityBar.ValueChanged += delegate
            {
                overlayOpacityValue.Text = overlayOpacityBar.Value + "%";
                if (overlayForm != null && !overlayForm.IsDisposed) overlayForm.SetOpacityPercent(overlayOpacityBar.Value);
                SaveSettingsFile();
            };
            actionLayout.Controls.Add(overlayOpacityBar, 1, 11);
            actionLayout.SetColumnSpan(overlayOpacityBar, 2);
            overlayOpacityValue.AutoSize = true;
            overlayOpacityValue.Text = overlayOpacityBar.Value + "%";
            overlayOpacityValue.ForeColor = Color.FromArgb(169, 189, 216);
            overlayOpacityValue.Margin = new Padding(8, 7, 0, 0);
            actionLayout.Controls.Add(overlayOpacityValue, 3, 11);

            actionLayout.Controls.Add(MakeLabel("Положение по вертикали:"), 0, 12);
            overlayVerticalBar.Minimum = 0;
            overlayVerticalBar.Maximum = 100;
            overlayVerticalBar.TickFrequency = 10;
            overlayVerticalBar.SmallChange = 2;
            overlayVerticalBar.LargeChange = 10;
            overlayVerticalBar.Value = Math.Max(0, Math.Min(100, SettingInt("overlay.vertical-position", 100)));
            overlayVerticalBar.AutoSize = false;
            overlayVerticalBar.Height = 34;
            overlayVerticalBar.Dock = DockStyle.Fill;
            overlayVerticalBar.BackColor = Color.FromArgb(8, 18, 35);
            overlayVerticalBar.ValueChanged += delegate
            {
                overlayVerticalValue.Text = VerticalPositionText(overlayVerticalBar.Value);
                if (overlayForm != null && !overlayForm.IsDisposed) overlayForm.SetVerticalPositionPercent(overlayVerticalBar.Value);
                SaveSettingsFile();
            };
            actionLayout.Controls.Add(overlayVerticalBar, 1, 12);
            actionLayout.SetColumnSpan(overlayVerticalBar, 2);
            overlayVerticalValue.AutoSize = true;
            overlayVerticalValue.Text = VerticalPositionText(overlayVerticalBar.Value);
            overlayVerticalValue.ForeColor = Color.FromArgb(169, 189, 216);
            overlayVerticalValue.Margin = new Padding(8, 7, 0, 0);
            actionLayout.Controls.Add(overlayVerticalValue, 3, 12);

            var overlayLabelOptions = new FlowLayoutPanel
            {
                AutoSize = true,
                Dock = DockStyle.Top,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = true,
                Margin = new Padding(0, 8, 0, 3)
            };
            ConfigureOverlayOptionCheck(overlayWhiteNotesCheck, "Ноты белых клавиш (F3/G3)", SettingBool("overlay.show-white-notes", true));
            ConfigureOverlayOptionCheck(overlayBlackNotesCheck, "Ноты чёрных клавиш (D#3)", SettingBool("overlay.show-black-notes", true));
            ConfigureOverlayOptionCheck(overlayQwertyBottomCheck, "QWERTY снизу без поворота", SettingBool("overlay.qwerty-bottom", false));
            overlayLabelOptions.Controls.Add(overlayWhiteNotesCheck);
            overlayLabelOptions.Controls.Add(overlayBlackNotesCheck);
            overlayLabelOptions.Controls.Add(overlayQwertyBottomCheck);
            actionLayout.Controls.Add(overlayLabelOptions, 0, 13);
            actionLayout.SetColumnSpan(overlayLabelOptions, 4);

            overlaySymbolsOnlyCheck.AutoSize = true;
            overlaySymbolsOnlyCheck.Text = "Только символы — клавиши и фон полностью прозрачны";
            overlaySymbolsOnlyCheck.Checked = SettingBool("overlay.symbols-only", false);
            overlaySymbolsOnlyCheck.ForeColor = Color.FromArgb(238, 247, 255);
            overlaySymbolsOnlyCheck.Margin = new Padding(0, 7, 0, 3);
            overlaySymbolsOnlyCheck.CheckedChanged += delegate
            {
                ApplyOverlayVisualSettings();
                SaveSettingsFile();
            };
            actionLayout.Controls.Add(overlaySymbolsOnlyCheck, 0, 14);
            actionLayout.SetColumnSpan(overlaySymbolsOnlyCheck, 4);

            actionLayout.Controls.Add(MakeLabel("Усиление контраста:"), 0, 15);
            overlayContrastBox.DropDownStyle = ComboBoxStyle.DropDownList;
            overlayContrastBox.Items.AddRange(new object[] { "Без усиления", "Контраст всего пианино", "Контраст только символов" });
            overlayContrastBox.SelectedIndex = Math.Max(0, Math.Min(2, SettingInt("overlay.contrast", 0)));
            overlayContrastBox.Dock = DockStyle.Fill;
            overlayContrastBox.BackColor = Color.FromArgb(15, 32, 60);
            overlayContrastBox.ForeColor = Color.FromArgb(238, 247, 255);
            overlayContrastBox.SelectedIndexChanged += delegate
            {
                ApplyOverlayVisualSettings();
                SaveSettingsFile();
            };
            actionLayout.Controls.Add(overlayContrastBox, 1, 15);
            actionLayout.SetColumnSpan(overlayContrastBox, 3);

            keyboardLayoutLabel.AutoSize = true;
            keyboardLayoutLabel.Text = "Раскладка активного окна: определяю…";
            keyboardLayoutLabel.ForeColor = Color.FromArgb(184, 151, 255);
            keyboardLayoutLabel.Margin = new Padding(0, 10, 8, 0);
            actionLayout.Controls.Add(keyboardLayoutLabel, 0, 16);
            actionLayout.SetColumnSpan(keyboardLayoutLabel, 2);

            editMappingButton.Text = "Переназначить буквы и символы…";
            StyleSecondaryButton(editMappingButton);
            editMappingButton.Margin = new Padding(0, 6, 0, 0);
            editMappingButton.Click += delegate { ShowMappingEditor(); };
            actionLayout.Controls.Add(editMappingButton, 2, 16);
            actionLayout.SetColumnSpan(editMappingButton, 2);

            resetSettingsButton.Text = "Вернуть все настройки по умолчанию";
            StyleSecondaryButton(resetSettingsButton);
            resetSettingsButton.Margin = new Padding(0, 10, 0, 0);
            resetSettingsButton.Click += delegate { RestoreDefaultSettings(); };
            actionLayout.Controls.Add(resetSettingsButton, 0, 17);
            actionLayout.SetColumnSpan(resetSettingsButton, 4);
            actionGroup.Controls.Add(actionLayout);
            root.Controls.Add(actionGroup, 0, 4);

            mappingBox.Dock = DockStyle.Fill;
            mappingBox.Multiline = true;
            mappingBox.ReadOnly = true;
            mappingBox.ScrollBars = ScrollBars.Vertical;
            mappingBox.BackColor = Color.FromArgb(5, 14, 29);
            mappingBox.ForeColor = Color.FromArgb(223, 247, 255);
            mappingBox.BorderStyle = BorderStyle.FixedSingle;
            mappingBox.Font = new Font("Consolas", 10F);
            mappingBox.MinimumSize = new Size(0, 250);
            mappingBox.Height = 250;
            mappingBox.Text = BuildMappingText();
            root.Controls.Add(mappingBox, 0, 5);

            lastNoteLabel.AutoSize = true;
            lastNoteLabel.Text = "Последняя MIDI-нота: —";
            lastNoteLabel.ForeColor = Color.FromArgb(169, 189, 216);
            lastNoteLabel.Margin = new Padding(0, 10, 0, 0);
            root.Controls.Add(lastNoteLabel, 0, 6);
        }

        private void LoadSettingsFile()
        {
            savedSettings.Clear();
            try
            {
                if (!File.Exists(settingsPath)) return;
                foreach (string rawLine in File.ReadAllLines(settingsPath, Encoding.UTF8))
                {
                    string line = (rawLine ?? String.Empty).Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    int separator = line.IndexOf('=');
                    if (separator <= 0) continue;
                    savedSettings[line.Substring(0, separator).Trim()] = line.Substring(separator + 1).Trim();
                }
            }
            catch { }
        }

        private int SettingInt(string key, int fallback)
        {
            string value;
            int parsed;
            return savedSettings.TryGetValue(key, out value) && Int32.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
        }

        private bool SettingBool(string key, bool fallback)
        {
            string value;
            if (!savedSettings.TryGetValue(key, out value)) return fallback;
            return value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
        }

        private void ApplySavedMapping()
        {
            if (!SettingBool("mapping.saved", false)) return;
            for (int midi = 36; midi <= 96; midi++)
            {
                string token;
                if (!savedSettings.TryGetValue("map." + midi, out token)) continue;
                KeyStroke stroke;
                if (TryParseStrokeToken(token, out stroke)) map[midi] = stroke;
                else map.Remove(midi);
            }
        }

        private void SaveSettingsFile()
        {
            if (applyingSettings || String.IsNullOrWhiteSpace(settingsPath)) return;
            try
            {
                var lines = new List<string>();
                lines.Add("# Piano Blind Trainer · настройки клавиатуры ПК v22.6");
                lines.Add("mapping.saved=1");
                for (int midi = 36; midi <= 96; midi++)
                {
                    KeyStroke stroke;
                    lines.Add("map." + midi + "=" + (map.TryGetValue(midi, out stroke) ? StrokeToken(stroke) : "-"));
                }
                lines.Add("action.space=" + Decimal.ToInt32(spaceNote.Value));
                lines.Add("action.control=" + Decimal.ToInt32(controlNote.Value));
                lines.Add("action.tab=" + Decimal.ToInt32(tabNote.Value));
                lines.Add("action.backspace-one=" + Decimal.ToInt32(backspaceOne.Value));
                lines.Add("action.backspace-two=" + Decimal.ToInt32(backspaceTwo.Value));
                lines.Add("action.alt=" + Decimal.ToInt32(altNote.Value));
                lines.Add("action.right-alt=" + Decimal.ToInt32(rightAltNote.Value));
                lines.Add("action.enter=" + Decimal.ToInt32(enterNote.Value));
                lines.Add("action.overlay=" + Decimal.ToInt32(overlayNote.Value));
                lines.Add("overlay.opacity=" + overlayOpacityBar.Value);
                lines.Add("overlay.vertical-position=" + overlayVerticalBar.Value);
                lines.Add("overlay.symbols-only=" + (overlaySymbolsOnlyCheck.Checked ? "1" : "0"));
                lines.Add("overlay.show-white-notes=" + (overlayWhiteNotesCheck.Checked ? "1" : "0"));
                lines.Add("overlay.show-black-notes=" + (overlayBlackNotesCheck.Checked ? "1" : "0"));
                lines.Add("overlay.qwerty-bottom=" + (overlayQwertyBottomCheck.Checked ? "1" : "0"));
                lines.Add("overlay.contrast=" + Math.Max(0, overlayContrastBox.SelectedIndex));
                File.WriteAllLines(settingsPath, lines.ToArray(), new UTF8Encoding(false));
            }
            catch (Exception error)
            {
                if (!closing)
                {
                    statusLabel.Text = "Не удалось сохранить настройки клавиатуры: " + error.Message;
                    statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
                }
            }
        }

        private static string VerticalPositionText(int percent)
        {
            int safe = Math.Max(0, Math.Min(100, percent));
            if (safe == 0) return "сверху";
            if (safe == 100) return "снизу";
            return safe + "% от верха";
        }

        private void ScrollSettingsByWheel(int delta)
        {
            if (delta == 0 || !settingsScrollPanel.AutoScroll) return;
            int current = -settingsScrollPanel.AutoScrollPosition.Y;
            int maximum = Math.Max(0, settingsScrollPanel.DisplayRectangle.Height - settingsScrollPanel.ClientSize.Height);
            int lines = SystemInformation.MouseWheelScrollLines;
            if (lines <= 0) lines = 3;
            int step = Math.Max(42, Math.Min(180, lines * 20));
            int target = Math.Max(0, Math.Min(maximum, current - Math.Sign(delta) * step));
            settingsScrollPanel.AutoScrollPosition = new Point(0, target);
        }

        private void RestoreDefaultSettings()
        {
            DialogResult answer = MessageBox.Show(
                "Вернуть исходные назначения MIDI-клавиш, раскладку букв, видимость и положение экранного пианино?\r\n\r\nТекущие пользовательские настройки будут заменены.",
                "Настройки по умолчанию",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );
            if (answer != DialogResult.Yes) return;

            StopBackspaceRepeat();
            ReleaseHeldModifiers();
            applyingSettings = true;
            try
            {
                map.Clear();
                foreach (KeyValuePair<int, KeyStroke> pair in CreateMap()) map[pair.Key] = pair.Value;
                tabNote.Value = 31;
                altNote.Value = 32;
                spaceNote.Value = 33;
                controlNote.Value = 34;
                backspaceOne.Value = 35;
                backspaceTwo.Value = 97;
                rightAltNote.Value = 98;
                enterNote.Value = 99;
                overlayNote.Value = 100;
                overlayOpacityBar.Value = 68;
                overlayVerticalBar.Value = 100;
                overlaySymbolsOnlyCheck.Checked = false;
                overlayWhiteNotesCheck.Checked = true;
                overlayBlackNotesCheck.Checked = true;
                overlayQwertyBottomCheck.Checked = false;
                overlayContrastBox.SelectedIndex = 0;
            }
            finally
            {
                applyingSettings = false;
            }

            mappingBox.Text = BuildMappingText();
            ApplyOverlayVisualSettings();
            if (overlayForm != null && !overlayForm.IsDisposed)
            {
                overlayForm.SetOpacityPercent(overlayOpacityBar.Value);
                overlayForm.SetVerticalPositionPercent(overlayVerticalBar.Value);
                overlayForm.UpdateMapping();
            }
            SaveSettingsFile();
            statusLabel.Text = "Все назначения и параметры экранного пианино возвращены к значениям по умолчанию.";
            statusLabel.ForeColor = Color.FromArgb(72, 224, 137);
        }

        private void InitializeBehaviorTimers()
        {
            backspaceRepeatTimer.Interval = BACKSPACE_REPEAT_DELAY;
            backspaceRepeatTimer.Tick += delegate
            {
                if (heldBackspaceNotes.Count == 0)
                {
                    StopBackspaceRepeat();
                    return;
                }
                if (!SendStroke(VK_BACK, false))
                {
                    StopBackspaceRepeat();
                    ShowSendInputWarning();
                    return;
                }
                if (backspaceRepeatTimer.Interval != BACKSPACE_REPEAT_INTERVAL) backspaceRepeatTimer.Interval = BACKSPACE_REPEAT_INTERVAL;
            };

            keyboardLayoutTimer.Interval = 250;
            keyboardLayoutTimer.Tick += delegate { UpdateActiveKeyboardLayout(false); };
            keyboardLayoutTimer.Start();
        }

        private void StartBackspaceRepeat(int note)
        {
            if (!heldBackspaceNotes.Add(note)) return;
            if (!SendStroke(VK_BACK, false))
            {
                heldBackspaceNotes.Remove(note);
                ShowSendInputWarning();
                return;
            }
            backspaceRepeatTimer.Stop();
            backspaceRepeatTimer.Interval = BACKSPACE_REPEAT_DELAY;
            backspaceRepeatTimer.Start();
        }

        private void ReleaseBackspaceNote(int note)
        {
            heldBackspaceNotes.Remove(note);
            if (heldBackspaceNotes.Count == 0) StopBackspaceRepeat();
        }

        private void StopBackspaceRepeat()
        {
            backspaceRepeatTimer.Stop();
            backspaceRepeatTimer.Interval = BACKSPACE_REPEAT_DELAY;
            heldBackspaceNotes.Clear();
        }

        private void UpdateActiveKeyboardLayout(bool force)
        {
            IntPtr foreground = GetForegroundWindow();
            uint processId;
            uint threadId = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out processId);
            IntPtr layout = GetKeyboardLayout(threadId);
            if (layout == IntPtr.Zero) layout = GetKeyboardLayout(0);
            ushort language = unchecked((ushort)(layout.ToInt64() & 0xFFFF));
            if (!force && layout == activeKeyboardLayout && language == activeKeyboardLanguage) return;

            activeKeyboardLayout = layout;
            activeKeyboardLanguage = language;
            keyboardLayoutLabel.Text = "Раскладка активного окна: " + KeyboardLayoutDisplayName(language) + " · подписи меняются автоматически";
            mappingBox.Text = BuildMappingText();
            RefreshOverlay();
        }

        private static string KeyboardLayoutDisplayName(ushort language)
        {
            int primary = language & 0x03FF;
            if (primary == 0x19) return "Русская (RU)";
            if (primary == 0x09) return "English (EN)";
            try { return CultureInfo.GetCultureInfo(language).NativeName; }
            catch { return "0x" + language.ToString("X4"); }
        }

        private string DisplayLabel(KeyStroke stroke)
        {
            int primary = activeKeyboardLanguage & 0x03FF;
            if (primary == 0x19) return RussianLabel(stroke);
            if (primary == 0x09 || activeKeyboardLayout == IntPtr.Zero) return EnglishLabel(stroke.VirtualKey, stroke.Shift);

            try
            {
                var state = new byte[256];
                if (stroke.Shift) state[VK_SHIFT] = 0x80;
                var buffer = new StringBuilder(8);
                uint scanCode = MapVirtualKeyEx(stroke.VirtualKey, 0, activeKeyboardLayout);
                int count = ToUnicodeEx(stroke.VirtualKey, scanCode, state, buffer, buffer.Capacity, 4, activeKeyboardLayout);
                if (count > 0)
                {
                    string value = buffer.ToString(0, Math.Min(count, buffer.Length));
                    if (!String.IsNullOrWhiteSpace(value)) return value;
                }
            }
            catch { }
            return stroke.Label;
        }

        private static string RussianLabel(KeyStroke stroke)
        {
            char key = (char)stroke.VirtualKey;
            string englishLetters = "QWERTYUIOPASDFGHJKLZXCVBNM";
            string russianLetters = "ЙЦУКЕНГШЩЗФЫВАПРОЛДЯЧСМИТЬ";
            int letterIndex = englishLetters.IndexOf(key);
            if (letterIndex >= 0)
            {
                string value = russianLetters.Substring(letterIndex, 1);
                return stroke.Shift ? value : value.ToLower(new CultureInfo("ru-RU"));
            }

            string digits = "1234567890";
            int digitIndex = digits.IndexOf(key);
            if (digitIndex >= 0)
            {
                if (!stroke.Shift) return digits.Substring(digitIndex, 1);
                string shiftedDigits = "!\"№;%:?*()";
                return shiftedDigits.Substring(digitIndex, 1);
            }
            return stroke.Label;
        }

        private static string EnglishLabel(ushort virtualKey, bool shift)
        {
            char key = (char)virtualKey;
            if (key >= 'A' && key <= 'Z') return shift ? key.ToString() : Char.ToLowerInvariant(key).ToString();
            if (key >= '0' && key <= '9')
            {
                if (!shift) return key.ToString();
                string shiftedDigits = ")!@#$%^&*(";
                return shiftedDigits.Substring(key - '0', 1);
            }
            return key.ToString();
        }

        private static bool TryParseStrokeToken(string token, out KeyStroke stroke)
        {
            stroke = new KeyStroke();
            string value = (token ?? String.Empty).Trim();
            if (value.Length == 0 || value == "-" || value == "(не назначено)") return false;
            bool shift = value.StartsWith("Shift+", StringComparison.OrdinalIgnoreCase);
            string keyText = shift ? value.Substring(6) : value;
            if (keyText.Length != 1 || !Char.IsLetterOrDigit(keyText[0])) return false;
            char key = Char.ToUpperInvariant(keyText[0]);
            stroke = new KeyStroke((ushort)key, shift, EnglishLabel((ushort)key, shift));
            return true;
        }

        private static string StrokeToken(KeyStroke stroke)
        {
            char key = (char)stroke.VirtualKey;
            return (stroke.Shift ? "Shift+" : String.Empty) + key;
        }

        private static List<string> BuildStrokeChoices()
        {
            var choices = new List<string>();
            choices.Add("(не назначено)");
            string[] rows = { "1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM" };
            foreach (string row in rows) foreach (char key in row) choices.Add(key.ToString());
            foreach (string row in rows) foreach (char key in row) choices.Add("Shift+" + key);
            return choices;
        }

        private void ShowMappingEditor()
        {
            var editor = new Form
            {
                Text = "Переназначение MIDI → клавиши ПК",
                StartPosition = FormStartPosition.CenterParent,
                Size = new Size(780, 720),
                MinimumSize = new Size(650, 520),
                BackColor = Color.FromArgb(8, 18, 35),
                ForeColor = Color.FromArgb(238, 247, 255),
                Font = Font,
                ShowInTaskbar = false
            };
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 1, RowCount = 3 };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            editor.Controls.Add(layout);

            var help = new Label
            {
                AutoSize = true,
                MaximumSize = new Size(730, 0),
                Text = "Для каждой MIDI-ноты выбери физическую клавишу ПК. Столбец «Символ сейчас» показывает результат в раскладке активного окна; в русской раскладке Q/W/E отображаются как й/ц/у. «Не назначено» освобождает ноту.",
                ForeColor = Color.FromArgb(169, 189, 216),
                Margin = new Padding(0, 0, 0, 10)
            };
            layout.Controls.Add(help, 0, 0);

            var grid = new DataGridView
            {
                Dock = DockStyle.Fill,
                AllowUserToAddRows = false,
                AllowUserToDeleteRows = false,
                AllowUserToResizeRows = false,
                RowHeadersVisible = false,
                AutoGenerateColumns = false,
                BackgroundColor = Color.FromArgb(5, 14, 29),
                ForeColor = Color.FromArgb(7, 20, 38),
                GridColor = Color.FromArgb(70, 96, 128),
                SelectionMode = DataGridViewSelectionMode.FullRowSelect
            };
            grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "MIDI", Width = 65, ReadOnly = true });
            grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Нота", Width = 75, ReadOnly = true });
            var keyColumn = new DataGridViewComboBoxColumn { HeaderText = "Физическая клавиша ПК", Width = 210, FlatStyle = FlatStyle.Flat };
            foreach (string choice in BuildStrokeChoices()) keyColumn.Items.Add(choice);
            grid.Columns.Add(keyColumn);
            grid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Символ сейчас", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, ReadOnly = true });
            grid.DataError += delegate { };
            layout.Controls.Add(grid, 0, 1);

            Action<int> refreshRow = delegate(int rowIndex)
            {
                if (rowIndex < 0 || rowIndex >= grid.Rows.Count) return;
                string token = Convert.ToString(grid.Rows[rowIndex].Cells[2].Value, CultureInfo.InvariantCulture);
                KeyStroke parsed;
                grid.Rows[rowIndex].Cells[3].Value = TryParseStrokeToken(token, out parsed) ? DisplayLabel(parsed) : "—";
            };

            for (int midi = 36; midi <= 96; midi++)
            {
                KeyStroke stroke;
                string token = map.TryGetValue(midi, out stroke) ? StrokeToken(stroke) : "(не назначено)";
                int row = grid.Rows.Add(midi, NoteName(midi), token, String.Empty);
                refreshRow(row);
            }
            grid.CurrentCellDirtyStateChanged += delegate
            {
                if (grid.IsCurrentCellDirty) grid.CommitEdit(DataGridViewDataErrorContexts.Commit);
            };
            grid.CellValueChanged += delegate(object sender, DataGridViewCellEventArgs eventArgs)
            {
                if (eventArgs.ColumnIndex == 2) refreshRow(eventArgs.RowIndex);
            };

            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(0, 10, 0, 0) };
            var applyButton = new Button { Text = "Применить" };
            var cancelButton = new Button { Text = "Отмена", DialogResult = DialogResult.Cancel };
            var resetButton = new Button { Text = "Вернуть исходную раскладку" };
            StylePrimaryButton(applyButton);
            StyleSecondaryButton(cancelButton);
            StyleSecondaryButton(resetButton);
            buttons.Controls.Add(applyButton);
            buttons.Controls.Add(cancelButton);
            buttons.Controls.Add(resetButton);
            layout.Controls.Add(buttons, 0, 2);
            editor.CancelButton = cancelButton;

            resetButton.Click += delegate
            {
                Dictionary<int, KeyStroke> defaults = CreateMap();
                for (int index = 0; index < grid.Rows.Count; index++)
                {
                    int midi = Convert.ToInt32(grid.Rows[index].Cells[0].Value, CultureInfo.InvariantCulture);
                    KeyStroke stroke;
                    grid.Rows[index].Cells[2].Value = defaults.TryGetValue(midi, out stroke) ? StrokeToken(stroke) : "(не назначено)";
                    refreshRow(index);
                }
            };

            applyButton.Click += delegate
            {
                var candidate = new Dictionary<int, KeyStroke>();
                foreach (DataGridViewRow row in grid.Rows)
                {
                    int midi = Convert.ToInt32(row.Cells[0].Value, CultureInfo.InvariantCulture);
                    KeyStroke stroke;
                    if (TryParseStrokeToken(Convert.ToString(row.Cells[2].Value, CultureInfo.InvariantCulture), out stroke)) candidate[midi] = stroke;
                }
                string[] actions = { ACTION_SPACE, ACTION_CONTROL, ACTION_TAB, ACTION_BACKSPACE_ONE, ACTION_BACKSPACE_TWO, ACTION_ALT, ACTION_RIGHT_ALT, ACTION_ENTER, ACTION_OVERLAY };
                foreach (string action in actions)
                {
                    int actionMidi = Decimal.ToInt32(PickerFor(action).Value);
                    if (!candidate.ContainsKey(actionMidi)) continue;
                    MessageBox.Show(NoteName(actionMidi) + " уже назначена на действие «" + ActionLabel(action) + "». Сначала выбери для действия другую свободную MIDI-ноту либо оставь эту строку неназначенной.", "Переназначение", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                map.Clear();
                foreach (KeyValuePair<int, KeyStroke> pair in candidate) map[pair.Key] = pair.Value;
                mappingBox.Text = BuildMappingText();
                RefreshOverlay();
                SaveSettingsFile();
                statusLabel.Text = "Раскладка букв и символов сохранена.";
                statusLabel.ForeColor = Color.FromArgb(72, 224, 137);
                editor.DialogResult = DialogResult.OK;
                editor.Close();
            };

            editor.ShowDialog(this);
            editor.Dispose();
        }

        private void ApplyOverlayVisualSettings()
        {
            if (overlayForm != null && !overlayForm.IsDisposed)
            {
                overlayForm.SetVisualMode(overlaySymbolsOnlyCheck.Checked, Math.Max(0, overlayContrastBox.SelectedIndex));
                overlayForm.SetLabelOptions(overlayWhiteNotesCheck.Checked, overlayBlackNotesCheck.Checked, overlayQwertyBottomCheck.Checked);
            }
        }

        private void ConfigureOverlayOptionCheck(CheckBox checkBox, string text, bool isChecked)
        {
            checkBox.AutoSize = true;
            checkBox.Text = text;
            checkBox.Checked = isChecked;
            checkBox.ForeColor = Color.FromArgb(238, 247, 255);
            checkBox.Margin = new Padding(0, 0, 12, 3);
            checkBox.CheckedChanged += delegate
            {
                ApplyOverlayVisualSettings();
                SaveSettingsFile();
            };
        }

        private void ConnectWheelLockedScrolling()
        {
            WheelLockedComboBox lockedDevice = deviceBox as WheelLockedComboBox;
            if (lockedDevice != null) lockedDevice.ScrollRequested = ScrollSettingsByWheel;
            WheelLockedTrackBar lockedOpacity = overlayOpacityBar as WheelLockedTrackBar;
            if (lockedOpacity != null) lockedOpacity.ScrollRequested = ScrollSettingsByWheel;
            WheelLockedTrackBar lockedVertical = overlayVerticalBar as WheelLockedTrackBar;
            if (lockedVertical != null) lockedVertical.ScrollRequested = ScrollSettingsByWheel;
            WheelLockedComboBox lockedContrast = overlayContrastBox as WheelLockedComboBox;
            if (lockedContrast != null) lockedContrast.ScrollRequested = ScrollSettingsByWheel;
        }

        private static Label MakeLabel(string text)
        {
            return new Label
            {
                AutoSize = true,
                Text = text,
                ForeColor = Color.FromArgb(238, 247, 255),
                Margin = new Padding(0, 7, 8, 0)
            };
        }

        private void ConfigureNotePicker(NumericUpDown picker, int value)
        {
            picker.Minimum = 21;
            picker.Maximum = 108;
            picker.Value = Math.Max(21, Math.Min(108, value));
            picker.Width = 72;
            picker.BackColor = Color.FromArgb(15, 32, 60);
            picker.ForeColor = Color.FromArgb(238, 247, 255);
            WheelLockedNumericUpDown lockedPicker = picker as WheelLockedNumericUpDown;
            if (lockedPicker != null) lockedPicker.ScrollRequested = ScrollSettingsByWheel;
        }

        private void AddActionRow(TableLayoutPanel layout, int row, string label, NumericUpDown picker, int defaultNote, Button learnButton, string action)
        {
            layout.Controls.Add(MakeLabel(label), 0, row);
            ConfigureNotePicker(picker, defaultNote);
            picker.ValueChanged += delegate
            {
                mappingBox.Text = BuildMappingText();
                RefreshOverlay();
                SaveSettingsFile();
                string assignmentError;
                if (!ValidateAssignments(out assignmentError))
                {
                    statusLabel.Text = assignmentError;
                    statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
                }
            };
            layout.Controls.Add(picker, 1, row);

            learnButton.Text = "Нажать и выбрать";
            StyleSecondaryButton(learnButton);
            learnButton.Click += delegate { BeginLearn(action); };
            layout.Controls.Add(learnButton, 2, row);

            var currentNote = new Label
            {
                AutoSize = true,
                Text = NoteName(Decimal.ToInt32(picker.Value)) + " (MIDI " + Decimal.ToInt32(picker.Value) + ")",
                ForeColor = Color.FromArgb(169, 189, 216),
                Margin = new Padding(8, 7, 0, 0)
            };
            picker.ValueChanged += delegate
            {
                int note = Decimal.ToInt32(picker.Value);
                currentNote.Text = NoteName(note) + " (MIDI " + note + ")";
            };
            layout.Controls.Add(currentNote, 3, row);
        }

        private static void StylePrimaryButton(Button button)
        {
            button.AutoSize = true;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 0;
            button.BackColor = Color.FromArgb(102, 217, 255);
            button.ForeColor = Color.FromArgb(7, 20, 38);
            button.Padding = new Padding(8, 5, 8, 5);
            button.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        }

        private static void StyleSecondaryButton(Button button)
        {
            button.AutoSize = true;
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(70, 96, 128);
            button.BackColor = Color.FromArgb(24, 43, 73);
            button.ForeColor = Color.FromArgb(238, 247, 255);
            button.Padding = new Padding(7, 4, 7, 4);
        }

        private void RefreshDevices()
        {
            if (midiHandle != IntPtr.Zero)
            {
                MessageBox.Show("Сначала выключи печать, затем обнови список устройств.", "MIDI", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            deviceBox.Items.Clear();
            uint count = midiInGetNumDevs();
            for (uint i = 0; i < count; i++)
            {
                MIDIINCAPS caps;
                uint result = midiInGetDevCaps(new UIntPtr(i), out caps, (uint)Marshal.SizeOf(typeof(MIDIINCAPS)));
                if (result == 0)
                {
                    deviceBox.Items.Add(new MidiDevice(i, String.IsNullOrWhiteSpace(caps.szPname) ? "MIDI input " + (i + 1) : caps.szPname));
                }
            }

            if (deviceBox.Items.Count > 0)
            {
                deviceBox.SelectedIndex = 0;
                statusLabel.Text = "Выбери MIDI-устройство и нажми «Включить печать».";
                statusLabel.ForeColor = Color.FromArgb(251, 191, 36);
            }
            else
            {
                statusLabel.Text = "MIDI-устройства не найдены. Подключи пианино и нажми «Обновить».";
                statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
            }
        }

        private void ToggleMidi()
        {
            if (midiHandle == IntPtr.Zero) StartMidi();
            else StopMidi();
        }

        private void StartMidi()
        {
            var device = deviceBox.SelectedItem as MidiDevice;
            if (device == null)
            {
                MessageBox.Show("MIDI-устройство не выбрано.", "MIDI", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string assignmentError;
            if (!ValidateAssignments(out assignmentError))
            {
                MessageBox.Show(assignmentError, "Дополнительные клавиши", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            midiCallback = OnMidiMessage;
            uint result = OpenMidiWithRetry(device);
            if (result != 0 || midiHandle == IntPtr.Zero)
            {
                midiHandle = IntPtr.Zero;
                string detail = MidiErrorText(result);
                statusLabel.Text = "MIDI не открыт. Код " + result + (String.IsNullOrWhiteSpace(detail) ? String.Empty : ": " + detail) + ".";
                statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
                MessageBox.Show("Не удалось открыть MIDI-устройство после четырёх автоматических попыток.\r\n\r\nКод ошибки: " + result + (String.IsNullOrWhiteSpace(detail) ? String.Empty : " — " + detail) + ".\r\n\r\nЗакрой другую программу, которая напрямую держит MIDI-порт, затем повтори запуск. Браузерный тренажёр в этой версии получает ноты через общий MIDI-мост и не должен занимать порт отдельно.", "MIDI", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            result = midiInStart(midiHandle);
            if (result != 0)
            {
                midiInClose(midiHandle);
                midiHandle = IntPtr.Zero;
                MessageBox.Show("Не удалось запустить приём MIDI. Код ошибки: " + result, "MIDI", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            deviceBox.Enabled = false;
            refreshButton.Enabled = false;
            toggleButton.Text = "Выключить печать";
            toggleButton.BackColor = Color.FromArgb(251, 113, 133);
            toggleButton.ForeColor = Color.FromArgb(43, 6, 16);
            statusLabel.Text = String.IsNullOrWhiteSpace(bridgeUrl) ? "Печать включена. Перейди в любую программу и нажимай клавиши пианино." : "Печать включена. Ноты одновременно отправляются в активную программу Windows и в урок браузера через MIDI-мост.";
            statusLabel.ForeColor = Color.FromArgb(72, 224, 137);
            PostBridgeStatus(true);
        }

        private uint OpenMidiWithRetry(MidiDevice device)
        {
            uint result = 1;
            for (int attempt = 0; attempt < 4; attempt++)
            {
                midiHandle = IntPtr.Zero;
                result = midiInOpen(out midiHandle, device.Id, midiCallback, IntPtr.Zero, CALLBACK_FUNCTION);
                if (result == 0 && midiHandle != IntPtr.Zero) return 0;
                if (midiHandle != IntPtr.Zero)
                {
                    midiInClose(midiHandle);
                    midiHandle = IntPtr.Zero;
                }
                if (attempt >= 3 || (result != 4 && result != 7 && result != 12)) break;
                statusLabel.Text = "MIDI-драйвер ещё освобождает порт. Повторяю подключение: " + (attempt + 2) + " / 4…";
                statusLabel.ForeColor = Color.FromArgb(251, 191, 36);
                statusLabel.Refresh();
                Thread.Sleep(250 + attempt * 250);
            }
            return result;
        }

        private static string MidiErrorText(uint code)
        {
            var text = new StringBuilder(256);
            uint result = midiInGetErrorText(code, text, (uint)text.Capacity);
            return result == 0 ? text.ToString().Trim() : String.Empty;
        }

        private void StopMidi()
        {
            StopBackspaceRepeat();
            ReleaseHeldModifiers();
            bool wasRunning = midiHandle != IntPtr.Zero;
            if (midiHandle != IntPtr.Zero)
            {
                midiInStop(midiHandle);
                midiInReset(midiHandle);
                midiInClose(midiHandle);
                midiHandle = IntPtr.Zero;
            }
            if (wasRunning) PostBridgeStatus(false);
            pressedMidiNotes.Clear();
            if (overlayForm != null && !overlayForm.IsDisposed) overlayForm.ClearPressed();

            learningAction = String.Empty;
            deviceBox.Enabled = true;
            refreshButton.Enabled = true;
            toggleButton.Text = "Включить печать";
            toggleButton.BackColor = Color.FromArgb(102, 217, 255);
            toggleButton.ForeColor = Color.FromArgb(7, 20, 38);
            statusLabel.Text = "Печать выключена.";
            statusLabel.ForeColor = Color.FromArgb(251, 191, 36);
            ResetLearnButtons();
        }

        private void BeginLearn(string action)
        {
            if (midiHandle == IntPtr.Zero)
            {
                MessageBox.Show("Сначала включи печать, чтобы программа могла услышать MIDI-ноту.", "Дополнительные клавиши", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            learningAction = action;
            ResetLearnButtons();
            LearnButtonFor(action).Text = "Нажми ноту…";
            statusLabel.Text = "Нажми на пианино свободную ноту для действия «" + ActionLabel(action) + "».";
            statusLabel.ForeColor = Color.FromArgb(184, 151, 255);
        }

        private NumericUpDown PickerFor(string action)
        {
            if (action == ACTION_BACKSPACE_ONE) return backspaceOne;
            if (action == ACTION_BACKSPACE_TWO) return backspaceTwo;
            if (action == ACTION_CONTROL) return controlNote;
            if (action == ACTION_TAB) return tabNote;
            if (action == ACTION_ALT) return altNote;
            if (action == ACTION_RIGHT_ALT) return rightAltNote;
            if (action == ACTION_ENTER) return enterNote;
            if (action == ACTION_SPACE) return spaceNote;
            return overlayNote;
        }

        private Button LearnButtonFor(string action)
        {
            if (action == ACTION_BACKSPACE_ONE) return learnOneButton;
            if (action == ACTION_BACKSPACE_TWO) return learnTwoButton;
            if (action == ACTION_CONTROL) return learnControlButton;
            if (action == ACTION_TAB) return learnTabButton;
            if (action == ACTION_ALT) return learnAltButton;
            if (action == ACTION_RIGHT_ALT) return learnRightAltButton;
            if (action == ACTION_ENTER) return learnEnterButton;
            if (action == ACTION_SPACE) return learnSpaceButton;
            return learnOverlayButton;
        }

        private static string ActionLabel(string action)
        {
            if (action == ACTION_BACKSPACE_ONE) return "Backspace слева";
            if (action == ACTION_BACKSPACE_TWO) return "Backspace справа";
            if (action == ACTION_CONTROL) return "Ctrl";
            if (action == ACTION_TAB) return "Tab";
            if (action == ACTION_ALT) return "Alt слева";
            if (action == ACTION_RIGHT_ALT) return "Alt справа (Right Alt)";
            if (action == ACTION_ENTER) return "Enter";
            if (action == ACTION_SPACE) return "Space / пробел";
            return "экранное пианино";
        }

        private void ResetLearnButtons()
        {
            learnOneButton.Text = "Нажать и выбрать";
            learnTwoButton.Text = "Нажать и выбрать";
            learnControlButton.Text = "Нажать и выбрать";
            learnTabButton.Text = "Нажать и выбрать";
            learnAltButton.Text = "Нажать и выбрать";
            learnRightAltButton.Text = "Нажать и выбрать";
            learnEnterButton.Text = "Нажать и выбрать";
            learnOverlayButton.Text = "Нажать и выбрать";
            learnSpaceButton.Text = "Нажать и выбрать";
        }

        private bool ValidateAssignments(out string error)
        {
            var used = new Dictionary<int, string>();
            string[] actions = { ACTION_SPACE, ACTION_CONTROL, ACTION_TAB, ACTION_BACKSPACE_ONE, ACTION_BACKSPACE_TWO, ACTION_ALT, ACTION_RIGHT_ALT, ACTION_ENTER, ACTION_OVERLAY };
            foreach (string action in actions)
            {
                int note = Decimal.ToInt32(PickerFor(action).Value);
                if (note < 21 || note > 108)
                {
                    error = "«" + ActionLabel(action) + "» должна быть назначена на одну из 88 клавиш A0–C8 (MIDI 21–108).";
                    return false;
                }
                if (map.ContainsKey(note))
                {
                    error = NoteName(note) + " (MIDI " + note + ") уже печатает символ «" + DisplayLabel(map[note]) + "». Назначь «" + ActionLabel(action) + "» на свободную ноту или освободи её в редакторе раскладки.";
                    return false;
                }
                if (used.ContainsKey(note))
                {
                    error = NoteName(note) + " (MIDI " + note + ") одновременно назначена на «" + used[note] + "» и «" + ActionLabel(action) + "». Для каждого действия нужна отдельная свободная нота.";
                    return false;
                }
                used[note] = ActionLabel(action);
            }
            error = String.Empty;
            return true;
        }

        private bool IsUsedByAnotherAction(int note, string selectedAction, out string otherAction)
        {
            string[] actions = { ACTION_SPACE, ACTION_CONTROL, ACTION_TAB, ACTION_BACKSPACE_ONE, ACTION_BACKSPACE_TWO, ACTION_ALT, ACTION_RIGHT_ALT, ACTION_ENTER, ACTION_OVERLAY };
            foreach (string action in actions)
            {
                if (action == selectedAction) continue;
                if (Decimal.ToInt32(PickerFor(action).Value) == note)
                {
                    otherAction = ActionLabel(action);
                    return true;
                }
            }
            otherAction = String.Empty;
            return false;
        }

        private bool IsActionNote(int note)
        {
            return note == Decimal.ToInt32(spaceNote.Value)
                || note == Decimal.ToInt32(controlNote.Value)
                || note == Decimal.ToInt32(tabNote.Value)
                || note == Decimal.ToInt32(backspaceOne.Value)
                || note == Decimal.ToInt32(backspaceTwo.Value)
                || note == Decimal.ToInt32(altNote.Value)
                || note == Decimal.ToInt32(rightAltNote.Value)
                || note == Decimal.ToInt32(enterNote.Value)
                || note == Decimal.ToInt32(overlayNote.Value);
        }

        private void ReleaseHeldModifiers()
        {
            if (heldControlNote >= 0) SendKeyState(VK_CONTROL, true);
            if (heldAltNote >= 0) SendKeyState(VK_ALT, true);
            if (heldRightAltNote >= 0) SendKeyState(VK_RMENU, true, true);
            heldControlNote = -1;
            heldAltNote = -1;
            heldRightAltNote = -1;
        }

        private void OnMidiMessage(IntPtr handle, uint message, IntPtr instance, UIntPtr param1, UIntPtr param2)
        {
            if (closing || message != MIM_DATA) return;

            uint packed = unchecked((uint)param1.ToUInt64());
            int status = (int)(packed & 0xFF);
            int command = status & 0xF0;
            int note = (int)((packed >> 8) & 0xFF);
            int velocity = (int)((packed >> 16) & 0xFF);
            bool noteOn = command == 0x90 && velocity > 0;
            bool noteOff = command == 0x80 || (command == 0x90 && velocity == 0);
            if (!noteOn && !noteOff) return;

            try
            {
                BeginInvoke((Action)(() => ProcessNote(note, noteOn, velocity)));
            }
            catch (InvalidOperationException) { }
        }

        private void ProcessNote(int note, bool noteOn, int velocity)
        {
            if (noteOn) pressedMidiNotes.Add(note); else pressedMidiNotes.Remove(note);
            if (overlayForm != null && !overlayForm.IsDisposed) overlayForm.SetPressed(note, noteOn);
            if (!IsActionNote(note)) PostBridgeMidi(note, noteOn, velocity);
            lastNoteLabel.Text = "Последняя MIDI-нота: " + NoteName(note) + " (" + note + ") · " + (noteOn ? "нажата" : "отпущена");

            if (noteOn && !String.IsNullOrEmpty(learningAction))
            {
                if (note < 21 || note > 108)
                {
                    statusLabel.Text = "Выбери одну из 88 клавиш A0–C8 (MIDI 21–108).";
                    statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
                    return;
                }
                if (map.ContainsKey(note))
                {
                    statusLabel.Text = NoteName(note) + " уже занята символом «" + DisplayLabel(map[note]) + "». Выбери свободную ноту или освободи её в редакторе раскладки.";
                    statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
                    return;
                }

                string otherAction;
                if (IsUsedByAnotherAction(note, learningAction, out otherAction))
                {
                    statusLabel.Text = NoteName(note) + " уже назначена на «" + otherAction + "». Выбери другую свободную ноту.";
                    statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
                    return;
                }

                string learnedAction = learningAction;
                PickerFor(learnedAction).Value = note;
                learningAction = String.Empty;
                ResetLearnButtons();
                statusLabel.Text = "«" + ActionLabel(learnedAction) + "» назначена на " + NoteName(note) + " (MIDI " + note + ").";
                statusLabel.ForeColor = Color.FromArgb(72, 224, 137);
                return;
            }

            if (!noteOn)
            {
                ReleaseBackspaceNote(note);
                if (note == heldControlNote)
                {
                    SendKeyState(VK_CONTROL, true);
                    heldControlNote = -1;
                }
                if (note == heldAltNote)
                {
                    SendKeyState(VK_ALT, true);
                    heldAltNote = -1;
                }
                if (note == heldRightAltNote)
                {
                    SendKeyState(VK_RMENU, true, true);
                    heldRightAltNote = -1;
                }
                return;
            }

            KeyStroke stroke;
            if (map.TryGetValue(note, out stroke))
            {
                if (!SendStroke(stroke.VirtualKey, stroke.Shift)) ShowSendInputWarning();
                return;
            }

            int backOne = Decimal.ToInt32(backspaceOne.Value);
            int backTwo = Decimal.ToInt32(backspaceTwo.Value);
            if (note == backOne || note == backTwo)
            {
                StartBackspaceRepeat(note);
                return;
            }

            if (note == Decimal.ToInt32(spaceNote.Value))
            {
                if (!SendStroke(VK_SPACE, false)) ShowSendInputWarning();
                return;
            }

            if (note == Decimal.ToInt32(enterNote.Value))
            {
                if (!SendStroke(VK_RETURN, false)) ShowSendInputWarning();
                return;
            }

            if (note == Decimal.ToInt32(tabNote.Value))
            {
                if (!SendStroke(VK_TAB, false)) ShowSendInputWarning();
                return;
            }

            if (note == Decimal.ToInt32(overlayNote.Value))
            {
                ToggleOverlay();
                return;
            }

            if (note == Decimal.ToInt32(controlNote.Value) && heldControlNote < 0)
            {
                if (SendKeyState(VK_CONTROL, false)) heldControlNote = note;
                else ShowSendInputWarning();
                return;
            }

            if (note == Decimal.ToInt32(altNote.Value) && heldAltNote < 0)
            {
                if (SendKeyState(VK_ALT, false)) heldAltNote = note;
                else ShowSendInputWarning();
                return;
            }

            if (note == Decimal.ToInt32(rightAltNote.Value) && heldRightAltNote < 0)
            {
                if (SendKeyState(VK_RMENU, false, true)) heldRightAltNote = note;
                else ShowSendInputWarning();
                return;
            }
        }

        private void ShowSendInputWarning()
        {
            statusLabel.Text = "Windows не приняла нажатие. Обычная программа не может печатать в окне, запущенном от имени администратора.";
            statusLabel.ForeColor = Color.FromArgb(251, 113, 133);
        }

        private void PostBridgeMidi(int note, bool noteOn, int velocity)
        {
            QueueBridgeJson("{\"type\":\"midi\",\"note\":" + note + ",\"on\":" + (noteOn ? "true" : "false") + ",\"velocity\":" + Math.Max(0, Math.Min(127, velocity)) + "}");
        }

        private void PostBridgeStatus(bool connected)
        {
            string json = BridgeStatusJson(connected, true);
            if (connected) QueueBridgeJson(json);
            else SendBridgeJson(json);
        }

        private void PostBridgeWindow(bool open)
        {
            string json = BridgeStatusJson(false, open);
            if (open) QueueBridgeJson(json);
            else SendBridgeJson(json);
        }

        private static string BridgeStatusJson(bool connected, bool windowOpen)
        {
            return "{\"type\":\"status\",\"connected\":" + (connected ? "true" : "false") + ",\"windowOpen\":" + (windowOpen ? "true" : "false") + "}";
        }

        private void StartBridgeHeartbeat()
        {
            if (String.IsNullOrWhiteSpace(bridgeUrl)) return;
            if (bridgeHeartbeat != null) bridgeHeartbeat.Dispose();
            bridgeHeartbeat = new System.Threading.Timer(delegate
            {
                if (!closing) QueueBridgeJson(BridgeStatusJson(midiHandle != IntPtr.Zero, true));
            }, null, 2000, 2000);
        }

        private void StopBridgeHeartbeat()
        {
            if (bridgeHeartbeat == null) return;
            bridgeHeartbeat.Dispose();
            bridgeHeartbeat = null;
        }

        private void QueueBridgeJson(string json)
        {
            if (String.IsNullOrWhiteSpace(bridgeUrl)) return;
            lock (bridgeQueueLock)
            {
                while (bridgeQueue.Count >= 512) bridgeQueue.Dequeue();
                bridgeQueue.Enqueue(json);
                if (bridgeWorkerRunning) return;
                bridgeWorkerRunning = true;
            }
            ThreadPool.QueueUserWorkItem(DrainBridgeQueue);
        }

        private void DrainBridgeQueue(object ignored)
        {
            while (true)
            {
                string json;
                lock (bridgeQueueLock)
                {
                    if (bridgeQueue.Count == 0)
                    {
                        bridgeWorkerRunning = false;
                        return;
                    }
                    json = bridgeQueue.Dequeue();
                }
                SendBridgeJson(json);
            }
        }

        private void SendBridgeJson(string json)
        {
            if (String.IsNullOrWhiteSpace(bridgeUrl)) return;
            try
            {
                byte[] body = Encoding.UTF8.GetBytes(json);
                var request = (HttpWebRequest)WebRequest.Create(bridgeUrl);
                request.Method = "POST";
                request.ContentType = "application/json; charset=utf-8";
                request.ContentLength = body.Length;
                request.Timeout = 600;
                request.ReadWriteTimeout = 600;
                request.KeepAlive = false;
                request.Proxy = null;
                request.Headers["X-PBT-Bridge-Token"] = bridgeToken;
                request.ServicePoint.Expect100Continue = false;
                using (Stream stream = request.GetRequestStream()) stream.Write(body, 0, body.Length);
                using (WebResponse response = request.GetResponse()) { }
            }
            catch { }
        }

        private string OverlayLabelForNote(int midi)
        {
            KeyStroke stroke;
            if (map.TryGetValue(midi, out stroke)) return DisplayLabel(stroke);
            if (midi == Decimal.ToInt32(spaceNote.Value)) return "Space";
            if (midi == Decimal.ToInt32(controlNote.Value)) return "Ctrl";
            if (midi == Decimal.ToInt32(tabNote.Value)) return "Tab";
            if (midi == Decimal.ToInt32(backspaceOne.Value) || midi == Decimal.ToInt32(backspaceTwo.Value)) return "Backspace";
            if (midi == Decimal.ToInt32(altNote.Value)) return "Alt L";
            if (midi == Decimal.ToInt32(rightAltNote.Value)) return "Alt R";
            if (midi == Decimal.ToInt32(enterNote.Value)) return "Enter";
            if (midi == Decimal.ToInt32(overlayNote.Value)) return "88 клавиш вкл/выкл";
            return "свободно";
        }

        private void ToggleOverlay()
        {
            if (overlayForm == null || overlayForm.IsDisposed)
            {
                overlayForm = new PianoOverlayForm(OverlayLabelForNote);
                overlayForm.SetOpacityPercent(overlayOpacityBar.Value);
                overlayForm.SetVerticalPositionPercent(overlayVerticalBar.Value);
                overlayForm.SetVisualMode(overlaySymbolsOnlyCheck.Checked, Math.Max(0, overlayContrastBox.SelectedIndex));
                overlayForm.SetLabelOptions(overlayWhiteNotesCheck.Checked, overlayBlackNotesCheck.Checked, overlayQwertyBottomCheck.Checked);
                overlayForm.SetPressedNotes(pressedMidiNotes);
            }
            if (overlayForm.Visible)
            {
                overlayForm.Hide();
                statusLabel.Text = "Прозрачное экранное пианино скрыто.";
            }
            else
            {
                overlayForm.UpdateMapping();
                overlayForm.PlaceAtSelectedPosition();
                overlayForm.Show();
                overlayForm.KeepOnTopWithoutFocus();
                statusLabel.Text = "88-клавишная подсказка показана поверх окон. Её высота меняется ползунком «Положение по вертикали»; мышь проходит насквозь.";
            }
            statusLabel.ForeColor = Color.FromArgb(72, 224, 137);
        }

        private void RefreshOverlay()
        {
            if (overlayForm != null && !overlayForm.IsDisposed) overlayForm.UpdateMapping();
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            closing = true;
            SaveSettingsFile();
            keyboardLayoutTimer.Stop();
            backspaceRepeatTimer.Stop();
            StopBridgeHeartbeat();
            if (overlayForm != null && !overlayForm.IsDisposed) overlayForm.Close();
            StopMidi();
            PostBridgeWindow(false);
        }

        private static bool SendStroke(ushort virtualKey, bool shift)
        {
            var inputs = new List<INPUT>();
            if (shift) inputs.Add(MakeKeyboardInput(VK_SHIFT, false));
            inputs.Add(MakeKeyboardInput(virtualKey, false));
            inputs.Add(MakeKeyboardInput(virtualKey, true));
            if (shift) inputs.Add(MakeKeyboardInput(VK_SHIFT, true));
            INPUT[] buffer = inputs.ToArray();
            return SendInput((uint)buffer.Length, buffer, Marshal.SizeOf(typeof(INPUT))) == (uint)buffer.Length;
        }

        private static bool SendKeyState(ushort virtualKey, bool keyUp)
        {
            return SendKeyState(virtualKey, keyUp, false);
        }

        private static bool SendKeyState(ushort virtualKey, bool keyUp, bool extended)
        {
            INPUT[] buffer = { MakeKeyboardInput(virtualKey, keyUp, extended) };
            return SendInput(1, buffer, Marshal.SizeOf(typeof(INPUT))) == 1;
        }

        private static INPUT MakeKeyboardInput(ushort virtualKey, bool keyUp)
        {
            return MakeKeyboardInput(virtualKey, keyUp, false);
        }

        private static INPUT MakeKeyboardInput(ushort virtualKey, bool keyUp, bool extended)
        {
            var input = new INPUT();
            input.type = 1;
            input.U.ki = new KEYBDINPUT
            {
                wVk = virtualKey,
                wScan = 0,
                dwFlags = (extended ? KEYEVENTF_EXTENDEDKEY : 0U) | (keyUp ? KEYEVENTF_KEYUP : 0U),
                time = 0,
                dwExtraInfo = UIntPtr.Zero
            };
            return input;
        }

        private static Dictionary<int, KeyStroke> CreateMap()
        {
            var result = new Dictionary<int, KeyStroke>();
            Add(result, 36, '1', false, "1");
            Add(result, 37, '1', true, "!");
            Add(result, 38, '2', false, "2");
            Add(result, 39, '2', true, "@");
            Add(result, 40, '3', false, "3");
            Add(result, 41, '4', false, "4");
            Add(result, 42, '4', true, "$");
            Add(result, 43, '5', false, "5");
            Add(result, 44, '5', true, "%");
            Add(result, 45, '6', false, "6");
            Add(result, 46, '6', true, "^");
            Add(result, 47, '7', false, "7");
            Add(result, 48, '8', false, "8");
            Add(result, 49, '8', true, "*");
            Add(result, 50, '9', false, "9");
            Add(result, 51, '9', true, "(");
            Add(result, 52, '0', false, "0");
            Add(result, 53, 'Q', false, "q");
            Add(result, 54, 'Q', true, "Q");
            Add(result, 55, 'W', false, "w");
            Add(result, 56, 'W', true, "W");
            Add(result, 57, 'E', false, "e");
            Add(result, 58, 'E', true, "E");
            Add(result, 59, 'R', false, "r");
            Add(result, 60, 'T', false, "t");
            Add(result, 61, 'T', true, "T");
            Add(result, 62, 'Y', false, "y");
            Add(result, 63, 'Y', true, "Y");
            Add(result, 64, 'U', false, "u");
            Add(result, 65, 'I', false, "i");
            Add(result, 66, 'I', true, "I");
            Add(result, 67, 'O', false, "o");
            Add(result, 68, 'O', true, "O");
            Add(result, 69, 'P', false, "p");
            Add(result, 70, 'P', true, "P");
            Add(result, 71, 'A', false, "a");
            Add(result, 72, 'S', false, "s");
            Add(result, 73, 'S', true, "S");
            Add(result, 74, 'D', false, "d");
            Add(result, 75, 'D', true, "D");
            Add(result, 76, 'F', false, "f");
            Add(result, 77, 'G', false, "g");
            Add(result, 78, 'G', true, "G");
            Add(result, 79, 'H', false, "h");
            Add(result, 80, 'H', true, "H");
            Add(result, 81, 'J', false, "j");
            Add(result, 82, 'J', true, "J");
            Add(result, 83, 'K', false, "k");
            Add(result, 84, 'L', false, "l");
            Add(result, 85, 'L', true, "L");
            Add(result, 86, 'Z', false, "z");
            Add(result, 87, 'Z', true, "Z");
            Add(result, 88, 'X', false, "x");
            Add(result, 89, 'C', false, "c");
            Add(result, 90, 'C', true, "C");
            Add(result, 91, 'V', false, "v");
            Add(result, 92, 'V', true, "V");
            Add(result, 93, 'B', false, "b");
            Add(result, 94, 'B', true, "B");
            Add(result, 95, 'N', false, "n");
            Add(result, 96, 'M', false, "m");
            return result;
        }

        private static void Add(Dictionary<int, KeyStroke> target, int midi, char key, bool shift, string label)
        {
            target[midi] = new KeyStroke((ushort)Char.ToUpperInvariant(key), shift, label);
        }

        private string BuildMappingText()
        {
            var lines = new List<string>();
            lines.Add("РАСКЛАДКА MIDI → КЛАВИАТУРА ПК · " + KeyboardLayoutDisplayName(activeKeyboardLanguage));
            lines.Add("");
            for (int midi = 36; midi <= 96; midi++)
            {
                KeyStroke stroke;
                if (map.TryGetValue(midi, out stroke))
                {
                    lines.Add(NoteName(midi).PadRight(5) + " MIDI " + midi.ToString().PadLeft(3) + "  →  " + StrokeToken(stroke).PadRight(8) + "  печатает: " + DisplayLabel(stroke));
                }
            }
            lines.Add("");
            lines.Add("СВОБОДНЫЕ MIDI-КЛАВИШИ");
            lines.Add(FormatActionMapping("Space / пробел", spaceNote));
            lines.Add(FormatActionMapping("Ctrl", controlNote));
            lines.Add(FormatActionMapping("Tab", tabNote));
            lines.Add(FormatActionMapping("Backspace слева", backspaceOne));
            lines.Add(FormatActionMapping("Backspace справа", backspaceTwo));
            lines.Add(FormatActionMapping("Alt слева", altNote));
            lines.Add(FormatActionMapping("Alt справа", rightAltNote));
            lines.Add(FormatActionMapping("Enter", enterNote));
            lines.Add(FormatActionMapping("88 клавиш вкл/выкл", overlayNote));
            lines.Add("");
            lines.Add("Backspace повторяется при удержании. Ctrl, левый Alt и правый Alt тоже удерживаются: так работают Ctrl+Z и Alt+Tab. Подписи экранного пианино следуют раскладке активного окна; русская ЙЦУКЕН поддерживается. Колесо мыши листает окно, но не меняет MIDI-номера, ползунки и выпадающие списки. В оверлее можно скрыть ноты белых/чёрных клавиш и вывести QWERTY снизу без поворота.");
            return String.Join(Environment.NewLine, lines.ToArray());
        }

        private static string FormatActionMapping(string label, NumericUpDown picker)
        {
            int midi = Decimal.ToInt32(picker.Value);
            return label.PadRight(18) + "  " + NoteName(midi).PadRight(5) + " MIDI " + midi;
        }

        private static string NoteName(int midi)
        {
            string[] names = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
            int note = ((midi % 12) + 12) % 12;
            int octave = (midi / 12) - 1;
            return names[note] + octave;
        }

        private static int WheelDeltaFromWParam(IntPtr wParam)
        {
            long value = wParam.ToInt64();
            return unchecked((short)((value >> 16) & 0xFFFF));
        }

        private sealed class WheelLockedNumericUpDown : NumericUpDown
        {
            public Action<int> ScrollRequested;

            protected override void OnMouseWheel(MouseEventArgs e)
            {
                HandledMouseEventArgs handled = e as HandledMouseEventArgs;
                if (handled != null) handled.Handled = true;
                if (ScrollRequested != null) ScrollRequested(e.Delta);
            }
        }

        private sealed class WheelLockedTrackBar : TrackBar
        {
            private const int WM_MOUSEWHEEL = 0x020A;
            public Action<int> ScrollRequested;

            protected override void WndProc(ref Message message)
            {
                if (message.Msg == WM_MOUSEWHEEL)
                {
                    if (ScrollRequested != null) ScrollRequested(WheelDeltaFromWParam(message.WParam));
                    return;
                }
                base.WndProc(ref message);
            }

            protected override void OnMouseWheel(MouseEventArgs e)
            {
                HandledMouseEventArgs handled = e as HandledMouseEventArgs;
                if (handled != null) handled.Handled = true;
                if (ScrollRequested != null) ScrollRequested(e.Delta);
            }
        }

        private sealed class WheelLockedComboBox : ComboBox
        {
            private const int WM_MOUSEWHEEL = 0x020A;
            public Action<int> ScrollRequested;

            protected override void WndProc(ref Message message)
            {
                if (message.Msg == WM_MOUSEWHEEL)
                {
                    if (ScrollRequested != null) ScrollRequested(WheelDeltaFromWParam(message.WParam));
                    return;
                }
                base.WndProc(ref message);
            }

            protected override void OnMouseWheel(MouseEventArgs e)
            {
                HandledMouseEventArgs handled = e as HandledMouseEventArgs;
                if (handled != null) handled.Handled = true;
                if (ScrollRequested != null) ScrollRequested(e.Delta);
            }
        }

        private sealed class MidiDevice
        {
            public readonly uint Id;
            public readonly string Name;
            public MidiDevice(uint id, string name) { Id = id; Name = name; }
            public override string ToString() { return Name; }
        }

        private struct KeyStroke
        {
            public readonly ushort VirtualKey;
            public readonly bool Shift;
            public readonly string Label;
            public KeyStroke(ushort virtualKey, bool shift, string label)
            {
                VirtualKey = virtualKey;
                Shift = shift;
                Label = label;
            }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct MIDIINCAPS
        {
            public ushort wMid;
            public ushort wPid;
            public uint vDriverVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string szPname;
            public uint dwSupport;
        }

        private delegate void MidiInProc(IntPtr hMidiIn, uint wMsg, IntPtr dwInstance, UIntPtr dwParam1, UIntPtr dwParam2);

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [DllImport("winmm.dll")]
        private static extern uint midiInGetNumDevs();

        [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiInGetDevCapsW")]
        private static extern uint midiInGetDevCaps(UIntPtr deviceId, out MIDIINCAPS caps, uint capsSize);

        [DllImport("winmm.dll")]
        private static extern uint midiInOpen(out IntPtr handle, uint deviceId, MidiInProc callback, IntPtr instance, uint flags);

        [DllImport("winmm.dll")]
        private static extern uint midiInStart(IntPtr handle);

        [DllImport("winmm.dll")]
        private static extern uint midiInStop(IntPtr handle);

        [DllImport("winmm.dll")]
        private static extern uint midiInReset(IntPtr handle);

        [DllImport("winmm.dll")]
        private static extern uint midiInClose(IntPtr handle);

        [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiInGetErrorTextW")]
        private static extern uint midiInGetErrorText(uint errorCode, StringBuilder errorText, uint errorTextSize);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetKeyboardLayout(uint threadId);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKeyEx(uint code, uint mapType, IntPtr keyboardLayout);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int ToUnicodeEx(uint virtualKey, uint scanCode, byte[] keyState, StringBuilder buffer, int bufferSize, uint flags, IntPtr keyboardLayout);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);
    }

    public sealed class PianoOverlayForm : Form
    {
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const int WM_NCHITTEST = 0x0084;
        private const int WM_MOUSEACTIVATE = 0x0021;
        private const int HTTRANSPARENT = -1;
        private const int MA_NOACTIVATE = 3;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

        private readonly Func<int, string> labelProvider;
        private readonly string[] noteNames = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" };
        private readonly HashSet<int> pressedNotes = new HashSet<int>();
        private bool symbolsOnly = false;
        private int contrastMode = 0;
        private int verticalPositionPercent = 100;
        private bool showWhiteNoteNames = true;
        private bool showBlackNoteNames = true;
        private bool qwertyAtBottom = false;

        public PianoOverlayForm(Func<int, string> provider)
        {
            labelProvider = provider;
            Text = "Piano Blind Trainer · 88-клавишная подсказка";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            BackColor = Color.Magenta;
            TransparencyKey = Color.Magenta;
            Opacity = 0.68;
            DoubleBuffered = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE;
                return parameters;
            }
        }

        public void PlaceAtSelectedPosition()
        {
            Rectangle working = Screen.PrimaryScreen.WorkingArea;
            int width = Math.Max(500, Math.Min(1760, working.Width - 28));
            int height = Math.Max(180, Math.Min(255, working.Height / 4));
            int top = working.Top + 4;
            int bottom = Math.Max(top, working.Bottom - height - 4);
            int y = top + (int)Math.Round((bottom - top) * (verticalPositionPercent / 100.0));
            Bounds = new Rectangle(working.Left + (working.Width - width) / 2, y, width, height);
        }

        public void SetOpacityPercent(int percent)
        {
            int safe = Math.Max(20, Math.Min(100, percent));
            Opacity = safe / 100.0;
        }

        public void SetVerticalPositionPercent(int percent)
        {
            verticalPositionPercent = Math.Max(0, Math.Min(100, percent));
            if (Visible) PlaceAtSelectedPosition();
        }

        public void SetVisualMode(bool showOnlySymbols, int selectedContrastMode)
        {
            symbolsOnly = showOnlySymbols;
            contrastMode = Math.Max(0, Math.Min(2, selectedContrastMode));
            Invalidate();
        }

        public void SetLabelOptions(bool showWhiteNotes, bool showBlackNotes, bool bottomQwerty)
        {
            showWhiteNoteNames = showWhiteNotes;
            showBlackNoteNames = showBlackNotes;
            qwertyAtBottom = bottomQwerty;
            Invalidate();
        }

        public void SetPressed(int midi, bool pressed)
        {
            if (pressed) pressedNotes.Add(midi); else pressedNotes.Remove(midi);
            Invalidate();
        }

        public void SetPressedNotes(IEnumerable<int> notes)
        {
            pressedNotes.Clear();
            if (notes != null) foreach (int note in notes) pressedNotes.Add(note);
            Invalidate();
        }

        public void ClearPressed()
        {
            pressedNotes.Clear();
            Invalidate();
        }

        public void KeepOnTopWithoutFocus()
        {
            if (!IsHandleCreated) return;
            SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }

        public void UpdateMapping()
        {
            if (!IsDisposed) Invalidate();
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            KeepOnTopWithoutFocus();
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WM_NCHITTEST)
            {
                message.Result = new IntPtr(HTTRANSPARENT);
                return;
            }
            if (message.Msg == WM_MOUSEACTIVATE)
            {
                message.Result = new IntPtr(MA_NOACTIVATE);
                return;
            }
            base.WndProc(ref message);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            e.Graphics.Clear(TransparencyKey);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics graphics = e.Graphics;
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.TextRenderingHint = symbolsOnly ? System.Drawing.Text.TextRenderingHint.AntiAliasGridFit : System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            int startMidi = 21;
            int endMidi = 108;
            int whiteCount = 52;
            float margin = 3F;
            float headerHeight = symbolsOnly ? 3F : 28F;
            float whiteWidth = (ClientSize.Width - margin * 2) / whiteCount;
            float whiteHeight = Math.Max(120F, ClientSize.Height - headerHeight - margin);
            float blackWidth = Math.Max(10F, whiteWidth * 0.64F);
            float blackHeight = whiteHeight * 0.62F;
            var whitePositions = new Dictionary<int, float>();
            bool strongPiano = contrastMode == 1;
            bool strongLabels = contrastMode == 2;

            if (!symbolsOnly)
            {
                using (var headerBrush = new SolidBrush(strongPiano ? Color.Black : Color.FromArgb(218, 7, 20, 38)))
                using (var headerText = new SolidBrush(Color.White))
                using (var headerFont = new Font("Segoe UI", 9F, FontStyle.Bold))
                {
                    graphics.FillRectangle(headerBrush, margin, 0, ClientSize.Width - margin * 2, headerHeight - 3F);
                    graphics.DrawString("88 клавиш A0–C8 · подписи следуют раскладке Windows · нажатые подсвечиваются жёлтым · мышь проходит насквозь", headerFont, headerText, new PointF(8F, 5F));
                }
            }

            int whiteIndex = 0;
            for (int midi = startMidi; midi <= endMidi; midi++)
            {
                if (!IsWhite(midi)) continue;
                float left = margin + whiteIndex * whiteWidth;
                whitePositions[midi] = left;
                RectangleF key = new RectangleF(left, headerHeight, whiteWidth + 0.2F, whiteHeight);
                bool pressed = pressedNotes.Contains(midi);
                if (!symbolsOnly)
                {
                    Color fillColor = pressed ? Color.FromArgb(255, 197, 32) : strongPiano ? Color.White : Color.FromArgb(244, 247, 252);
                    Color borderColor = pressed ? Color.White : strongPiano ? Color.Black : Color.FromArgb(20, 35, 58);
                    using (var fill = new SolidBrush(fillColor)) graphics.FillRectangle(fill, key);
                    using (var border = new Pen(borderColor, pressed ? 2.8F : strongPiano ? 2F : 1F)) graphics.DrawRectangle(border, key.X, key.Y, key.Width, key.Height);
                }
                else if (pressed)
                {
                    DrawPressedSymbolIndicator(graphics, key, false);
                }
                DrawKeyLabels(graphics, midi, key, false, pressed, strongLabels);
                whiteIndex++;
            }

            for (int midi = startMidi; midi <= endMidi; midi++)
            {
                if (IsWhite(midi)) continue;
                int previous = midi - 1;
                while (previous >= startMidi && !IsWhite(previous)) previous--;
                float previousLeft = whitePositions.ContainsKey(previous) ? whitePositions[previous] : margin;
                float left = previousLeft + whiteWidth - blackWidth / 2F;
                RectangleF key = new RectangleF(left, headerHeight, blackWidth, blackHeight);
                bool pressed = pressedNotes.Contains(midi);
                if (!symbolsOnly)
                {
                    Color fillColor = pressed ? Color.FromArgb(255, 197, 32) : strongPiano ? Color.Black : Color.FromArgb(5, 11, 23);
                    using (var fill = new SolidBrush(fillColor)) graphics.FillRectangle(fill, key);
                    Color borderColor = pressed || strongPiano ? Color.White : Color.Black;
                    using (var border = new Pen(borderColor, pressed ? 2.8F : strongPiano ? 1.8F : 1F)) graphics.DrawRectangle(border, key.X, key.Y, key.Width, key.Height);
                }
                else if (pressed)
                {
                    DrawPressedSymbolIndicator(graphics, key, true);
                }
                DrawKeyLabels(graphics, midi, key, true, pressed, strongLabels);
            }
        }

        private static void DrawPressedSymbolIndicator(Graphics graphics, RectangleF key, bool black)
        {
            float inset = black ? 1.2F : 2F;
            RectangleF outline = new RectangleF(
                key.Left + inset,
                key.Top + inset,
                Math.Max(1F, key.Width - inset * 2F),
                Math.Max(1F, key.Height - inset * 2F)
            );
            using (var pressedFill = new SolidBrush(Color.FromArgb(black ? 92 : 72, 255, 197, 32)))
            using (var glow = new Pen(Color.FromArgb(255, 197, 32), black ? 4.6F : 5.2F))
            using (var core = new Pen(Color.White, 1.2F))
            using (var dot = new SolidBrush(Color.FromArgb(255, 224, 92)))
            {
                graphics.FillRectangle(pressedFill, outline);
                graphics.DrawRectangle(glow, outline.X, outline.Y, outline.Width, outline.Height);
                graphics.DrawRectangle(core, outline.X, outline.Y, outline.Width, outline.Height);
                float dotSize = Math.Max(7F, Math.Min(15F, key.Width * 0.55F));
                graphics.FillEllipse(dot, key.Left + (key.Width - dotSize) / 2F, key.Top + 6F, dotSize, dotSize);
            }
        }

        private void DrawKeyLabels(Graphics graphics, int midi, RectangleF key, bool black, bool pressed, bool strongLabels)
        {
            string note = NoteName(midi);
            string mapping = labelProvider == null ? String.Empty : labelProvider(midi);
            if (mapping == "свободно") mapping = "—";
            bool showMapping = !String.IsNullOrWhiteSpace(mapping) && mapping != "—";
            bool showNote = black ? showBlackNoteNames : showWhiteNoteNames;
            Color textColor = pressed
                ? (symbolsOnly ? Color.FromArgb(255, 211, 64) : Color.FromArgb(7, 20, 38))
                : (symbolsOnly || strongLabels ? Color.White : black ? Color.White : Color.FromArgb(7, 20, 38));
            float noteSize = symbolsOnly
                ? Math.Max(8.6F, Math.Min(14F, key.Width * 0.54F))
                : Math.Max(5.4F, Math.Min(8F, key.Width * 0.28F));
            float mappingSize = symbolsOnly
                ? Math.Max(8.8F, Math.Min(14.8F, key.Width * 0.54F))
                : Math.Max(5.2F, Math.Min(8.2F, key.Width * 0.27F));
            float bottomMappingSize = symbolsOnly
                ? Math.Max(10.5F, Math.Min(18F, key.Width * 0.64F))
                : Math.Max(7.4F, Math.Min(12.5F, key.Width * 0.42F));
            using (var noteFont = new Font("Segoe UI", noteSize, FontStyle.Bold))
            using (var mappingFont = new Font("Segoe UI", mappingSize, FontStyle.Bold))
            using (var bottomMappingFont = new Font("Segoe UI", bottomMappingSize, FontStyle.Bold))
            using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter })
            {
                bool halo = symbolsOnly || strongLabels;
                float haloSize = pressed && symbolsOnly ? 3F : strongLabels ? 2F : symbolsOnly ? 1.8F : 1.1F;
                if (showNote)
                {
                    RectangleF noteBounds = qwertyAtBottom
                        ? new RectangleF(key.Left, key.Top + (black ? 5F : 10F), key.Width, symbolsOnly ? 22F : 18F)
                        : new RectangleF(key.Left, key.Bottom - 21F, key.Width, 18F);
                    DrawTextWithHalo(graphics, note, noteFont, textColor, noteBounds, format, halo, haloSize);
                }
                if (!showMapping) return;
                if (qwertyAtBottom)
                {
                    RectangleF mappingBounds = new RectangleF(key.Left - 1F, key.Bottom - (symbolsOnly ? 32F : 27F), key.Width + 2F, symbolsOnly ? 29F : 23F);
                    DrawTextWithHalo(graphics, mapping, bottomMappingFont, textColor, mappingBounds, format, halo, Math.Max(haloSize, symbolsOnly ? 2.4F : 1.2F));
                    return;
                }
                GraphicsState saved = graphics.Save();
                graphics.TranslateTransform(key.Left + key.Width / 2F, key.Top + (key.Height - 23F) / 2F);
                graphics.RotateTransform(-90F);
                DrawTextWithHalo(graphics, mapping, mappingFont, textColor, new RectangleF(-(key.Height - 28F) / 2F, -key.Width / 2F, key.Height - 28F, key.Width), format, halo, haloSize);
                graphics.Restore(saved);
            }
        }

        private static void DrawTextWithHalo(Graphics graphics, string text, Font font, Color textColor, RectangleF bounds, StringFormat format, bool halo, float haloSize)
        {
            if (halo)
            {
                using (var outline = new SolidBrush(Color.FromArgb(235, 0, 0, 0)))
                {
                    float[] offsets = { -haloSize, 0F, haloSize };
                    foreach (float x in offsets)
                    {
                        foreach (float y in offsets)
                        {
                            if (x == 0F && y == 0F) continue;
                            graphics.DrawString(text, font, outline, new RectangleF(bounds.X + x, bounds.Y + y, bounds.Width, bounds.Height), format);
                        }
                    }
                }
            }
            using (var brush = new SolidBrush(textColor)) graphics.DrawString(text, font, brush, bounds, format);
        }

        private bool IsWhite(int midi)
        {
            int pitch = ((midi % 12) + 12) % 12;
            return pitch == 0 || pitch == 2 || pitch == 4 || pitch == 5 || pitch == 7 || pitch == 9 || pitch == 11;
        }

        private string NoteName(int midi)
        {
            int pitch = ((midi % 12) + 12) % 12;
            return noteNames[pitch] + ((midi / 12) - 1);
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    }
}
'@

try {
    if (-not [String]::IsNullOrWhiteSpace($env:PBT_MIDI_STATUS_FILE)) {
        [IO.File]::WriteAllText($env:PBT_MIDI_STATUS_FILE, 'STARTING:PowerShell загружен, компилирую Windows-окно.', (New-Object Text.UTF8Encoding($false)))
    }
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing')
    [PianoBlindTrainerMidiKeyboard.Program]::Run($env:PBT_MIDI_STATUS_FILE)
}
catch {
    $message = "Не удалось запустить режим «Пианино → клавиатура ПК».`r`n`r`n$($_.Exception.Message)"
    if (-not [String]::IsNullOrWhiteSpace($env:PBT_MIDI_LOG_FILE)) {
        try { [IO.File]::WriteAllText($env:PBT_MIDI_LOG_FILE, $_.Exception.ToString(), (New-Object Text.UTF8Encoding($false))) } catch { }
    }
    if (-not [String]::IsNullOrWhiteSpace($env:PBT_MIDI_STATUS_FILE)) {
        try {
            $statusMessage = "ERROR:" + ($_.Exception.Message -replace "[`r`n]+", " ")
            [IO.File]::WriteAllText($env:PBT_MIDI_STATUS_FILE, $statusMessage, (New-Object Text.UTF8Encoding($false)))
        }
        catch { }
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($message, 'Piano Blind Trainer', 'OK', 'Error') | Out-Null
    }
    catch {
        Write-Error $message
    }
    exit 1
}
