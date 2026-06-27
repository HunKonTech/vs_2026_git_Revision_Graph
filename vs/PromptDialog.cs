using System.Windows;
using System.Windows.Controls;

namespace RevisionGraph
{
    /// <summary>
    /// A tiny VS-themed single-line input dialog, built in code so it needs no
    /// XAML. Used to collect the new message when rewording a commit.
    /// </summary>
    public sealed class PromptDialog : Window
    {
        private readonly TextBox _box;

        public string Value => _box.Text;

        private PromptDialog(string title, string prompt, string defaultValue)
        {
            Title = title;
            Width = 420;
            SizeToContent = SizeToContent.Height;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;

            var grid = new Grid { Margin = new Thickness(14) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var promptText = new TextBlock
            {
                Text = prompt,
                Margin = new Thickness(0, 0, 0, 6),
                TextWrapping = TextWrapping.Wrap,
            };
            Grid.SetRow(promptText, 0);
            grid.Children.Add(promptText);

            _box = new TextBox
            {
                Text = defaultValue ?? string.Empty,
                Height = 24,
                VerticalContentAlignment = VerticalAlignment.Center,
            };
            Grid.SetRow(_box, 1);
            grid.Children.Add(_box);

            var buttons = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Margin = new Thickness(0, 12, 0, 0),
            };
            var ok = new Button { Content = "OK", Width = 84, Height = 26, Margin = new Thickness(0, 0, 8, 0), IsDefault = true };
            ok.Click += (_, __) => { DialogResult = true; };
            var cancel = new Button { Content = "Cancel", Width = 84, Height = 26, IsCancel = true };
            buttons.Children.Add(ok);
            buttons.Children.Add(cancel);
            Grid.SetRow(buttons, 2);
            grid.Children.Add(buttons);

            Content = grid;
            Loaded += (_, __) => { _box.Focus(); _box.SelectAll(); };
        }

        /// <summary>
        /// Show the prompt. Returns the entered text, or null if the user
        /// cancelled or left it blank.
        /// </summary>
        public static string Show(Window owner, string title, string prompt, string defaultValue)
        {
            var dlg = new PromptDialog(title, prompt, defaultValue);
            if (owner != null) dlg.Owner = owner;
            if (dlg.ShowDialog() != true) return null;
            var v = (dlg.Value ?? string.Empty).Trim();
            return v.Length == 0 ? null : v;
        }
    }
}
