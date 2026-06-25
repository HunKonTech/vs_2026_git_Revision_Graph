using System.Text.RegularExpressions;
using System.Windows;

namespace RevisionGraph
{
    /// <summary>
    /// Lightweight, VS-themed "new branch" dialog seeded from a commit sha.
    /// Used by <see cref="WebViewHostControl"/> when the user picks
    /// "Create branch from here" in the graph's context menu.
    /// </summary>
    public partial class NewBranchDialog : Window
    {
        // Disallows whitespace and the characters git refuses in branch names.
        private static readonly Regex Invalid = new Regex(@"[\s~^:?*\[\\]");

        public string BranchName { get; private set; }
        public bool Checkout { get; private set; }

        public NewBranchDialog(string sha)
        {
            InitializeComponent();
            StartPointText.Text = "New branch starting from commit " +
                                  (sha != null && sha.Length >= 7 ? sha.Substring(0, 7) : sha);
            Loaded += (_, __) => NameBox.Focus();
        }

        private void OnOk(object sender, RoutedEventArgs e)
        {
            var name = (NameBox.Text ?? string.Empty).Trim();
            if (name.Length == 0 || Invalid.IsMatch(name) || name.StartsWith("-") ||
                name.EndsWith("/") || name.EndsWith(".lock"))
            {
                MessageBox.Show(this, "Please enter a valid branch name.", "Create Branch",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            BranchName = name;
            Checkout = CheckoutBox.IsChecked == true;
            DialogResult = true;
        }
    }
}
