import { DbtPackageInfo, DbtPackageVersions } from 'dbt-language-server-common';
import { QuickInputButtons, QuickPickItem, QuickPickItemKind, Selection, ThemeIcon, Uri, commands, env, workspace } from 'vscode';
import { DbtLanguageClientManager } from '../DbtLanguageClientManager';
import { OutputChannelProvider } from '../OutputChannelProvider';
import { DbtWizardQuickPick } from '../QuickPick';
import { PACKAGES_YML } from '../Utils';
import { Command } from './CommandManager';
import { OpenOrCreatePackagesYml } from './OpenOrCreatePackagesYml';
import path = require('node:path');

export class InstallDbtPackages implements Command {
  static readonly ID = 'WizardForDbtCore(TM).installDbtPackages';
  readonly id = InstallDbtPackages.ID;

  static readonly SEPARATOR = { label: '', kind: QuickPickItemKind.Separator };
  static readonly DBT_HUB_TOOLTIP = 'Open dbt hub';
  static readonly HUB_URI = Uri.parse('https://hub.getdbt.com');
  static readonly GIT_HUB_BUTTON = { iconPath: new ThemeIcon('github'), tooltip: 'Open in GitHub' };
  static readonly DBT_HUB_BUTTON = { iconPath: new ThemeIcon('link-external'), tooltip: InstallDbtPackages.DBT_HUB_TOOLTIP };

  selectedPackage?: string;

  constructor(private dbtLanguageClientManager: DbtLanguageClientManager, private outputChannelProvider: OutputChannelProvider) {}

  async execute(projectPath?: string): Promise<void> {
    if (projectPath) {
      const profilesUri = Uri.file(path.join(projectPath, PACKAGES_YML));
      try {
        await workspace.fs.stat(profilesUri);
        await commands.executeCommand('vscode.open', profilesUri);
      } catch {
        // file does not exist
      }
    }

    const client =
      projectPath === undefined
        ? await this.dbtLanguageClientManager.getClientForActiveDocument()
        : this.dbtLanguageClientManager.getClientByPath(projectPath);

    if (client) {
      const packagesPromise = client.sendRequest<DbtPackageInfo[]>('WizardForDbtCore(TM)/getListOfPackages');

      let version = undefined;
      let packageName = undefined;
      let backPressed;
      do {
        backPressed = false;
        packageName = await this.getPackage(packagesPromise, this.selectedPackage);
        this.selectedPackage = packageName;

        if (packageName !== undefined) {
          const versionsPromise = client.sendRequest<DbtPackageVersions>('WizardForDbtCore(TM)/getPackageVersions', packageName);
          try {
            version = await this.getVersion(packagesPromise, packageName, versionsPromise);
          } catch (e) {
            backPressed = e === QuickInputButtons.Back;
          }
        }
      } while (backPressed);

      if (packageName && version) {
        this.outputChannelProvider.getDbtDepsChannel().show();
        await client.sendRequest<number>('WizardForDbtCore(TM)/addNewDbtPackage', { packageName, version });
        const textEditor = await OpenOrCreatePackagesYml.openOrCreateConfig(client.getProjectUri().fsPath);

        // Sometimes document is not in refreshed state and we should ensure that it contains changes made on LS side
        // https://github.com/microsoft/vscode/issues/7532#issuecomment-460158858
        await commands.executeCommand('workbench.action.files.revert');

        const offset = textEditor.document.getText().indexOf(`package: ${packageName}`);
        const { line } = textEditor.document.positionAt(offset);
        textEditor.selection = new Selection(line, 0, line + 2, 0);
      }
    }
  }

  private async getPackage(packagesPromise: Promise<DbtPackageInfo[]>, activeItemLabel?: string): Promise<string | undefined> {
    return DbtWizardQuickPick.showQuickPick(
      {
        buttons: [InstallDbtPackages.DBT_HUB_BUTTON],
        placeholder: 'Filter by name, e.g. salesforce',
        title: 'Select dbt package to install',
      },
      packagesPromise.then(p => this.createPackageNameItems(p)),
      async e => {
        const packages = await packagesPromise;
        const packageInfo = packages.find(p => p.installString === e.item.label);
        if (packageInfo) {
          await env.openExternal(Uri.parse(`https://github.com/${packageInfo.gitHubUser}/${packageInfo.repositoryName}#readme`));
        }
      },
      activeItemLabel,
    );
  }

  getVersion(
    packagesPromise: Promise<DbtPackageInfo[]>,
    packageName: string,
    versionsPromise: Promise<DbtPackageVersions>,
  ): Promise<string | undefined> {
    return DbtWizardQuickPick.showQuickPick(
      {
        buttons: [QuickInputButtons.Back, InstallDbtPackages.DBT_HUB_BUTTON],
        placeholder: 'Filter by version, e.g. 0.5.0',
        title: `Select version of ${packageName} to install`,
      },
      versionsPromise.then(v => this.createVersionItems(v)),
      async e => {
        const packages = await packagesPromise;
        const packageInfo = packages.find(p => p.installString === packageName);
        if (packageInfo) {
          const versions = await versionsPromise;
          const actualTagName = versions[e.item.label];
          await env.openExternal(
            Uri.parse(`https://github.com/${packageInfo.gitHubUser}/${packageInfo.repositoryName}/tree/${actualTagName}/#readme`),
          );
        }
      },
    );
  }

  createPackageNameItems(packages: DbtPackageInfo[]): QuickPickItem[] {
    packages.sort((p1, p2) => p1.installString.localeCompare(p2.installString));

    let lastGitHubUser = undefined;
    const items: QuickPickItem[] = [];

    for (const packageInfo of packages) {
      if (lastGitHubUser !== packageInfo.gitHubUser) {
        items.push(InstallDbtPackages.SEPARATOR);
        lastGitHubUser = packageInfo.gitHubUser;
      }

      items.push({
        label: packageInfo.installString,
        buttons: [InstallDbtPackages.GIT_HUB_BUTTON],
      });
    }
    return items;
  }

  createVersionItems(versions: DbtPackageVersions): QuickPickItem[] {
    return Object.keys(versions)
      .sort((v1, v2) => v2.localeCompare(v1))
      .map(label => ({
        label,
        buttons: [InstallDbtPackages.GIT_HUB_BUTTON],
      }));
  }
}
