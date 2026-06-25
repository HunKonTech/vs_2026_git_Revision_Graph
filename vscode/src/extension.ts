import * as vscode from "vscode";
import { GraphPanel } from "./panel";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("revGraph.show", () => GraphPanel.show(context)),
    vscode.commands.registerCommand("revGraph.refresh", () => GraphPanel.refreshActive()),
  );
}

export function deactivate(): void {
  // nothing to clean up; panel disposes itself
}
