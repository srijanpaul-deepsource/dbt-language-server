import { deferred } from 'dbt-language-server-common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Dag } from './dag/Dag';
import { ManifestMacro, ManifestModel, ManifestNode, ManifestSource } from './manifest/ManifestJson';

export class DbtRepository {
  static readonly DBT_PROJECT_FILE_NAME = 'dbt_project.yml';
  static readonly DBT_MANIFEST_FILE_NAME = 'manifest.json';
  static readonly DBT_PROJECT_NAME_FIELD = 'name';

  static readonly PROFILE_NAME_FIELD = 'profile';

  static readonly MACRO_PATHS_FIELD = 'macro-paths';
  static readonly SOURCE_PATHS_FIELD = 'source-paths'; // v1.0.0: The config source-paths has been deprecated in favor of model-paths
  static readonly MODEL_PATHS_FIELD = 'model-paths';

  static readonly DBT_PACKAGES_FILE_NAME = 'packages.yml';
  static readonly PACKAGES_INSTALL_PATH_FIELD = 'packages-install-path'; // v1.0.0: The default config has changed from modules-path to packages-install-path with a new default value of dbt_packages
  static readonly MODULE_PATH = 'module-path';

  static readonly TARGET_PATH_FIELD = 'target-path';
  static readonly DEFAULT_TARGET_PATH = 'target';

  static readonly DEFAULT_MACRO_PATHS = ['macros'];
  static readonly DEFAULT_MODEL_PATHS = ['models'];
  static readonly DEFAULT_PACKAGES_PATH = 'dbt_packages';

  dbtTargetPath = DbtRepository.DEFAULT_TARGET_PATH;
  projectName?: string;
  macroPaths: string[] = DbtRepository.DEFAULT_MACRO_PATHS;
  modelPaths: string[] = DbtRepository.DEFAULT_MODEL_PATHS;
  packagesInstallPath = DbtRepository.DEFAULT_PACKAGES_PATH;

  manifestParsedDeferred = deferred<void>();

  macros: ManifestMacro[] = [];
  sources: ManifestSource[] = [];
  dag: Dag = new Dag([]);

  packageToModels = new Map<string, Set<ManifestModel>>();
  packageToMacros = new Map<string, Set<ManifestMacro>>();
  packageToSources = new Map<string, Map<string, Set<ManifestSource>>>();

  globalProjectPath?: string;

  constructor(public projectPath: string, globalProjectPath: Promise<string | undefined>) {
    globalProjectPath
      .then(p => {
        this.globalProjectPath = p;
        return undefined;
      })
      .catch(() => console.log('Error when getting global_project path'));
  }

  manifestParsed(): Promise<void> {
    return this.manifestParsedDeferred.promise;
  }

  updateDbtNodes(macros: ManifestMacro[], sources: ManifestSource[], dag: Dag): void {
    this.macros = macros;
    this.sources = sources;
    this.dag = dag;

    this.groupManifestNodes();

    this.manifestParsedDeferred.resolve();
  }

  getModelCompiledPath(model: ManifestModel): string {
    return path.resolve(this.dbtTargetPath, 'compiled', model.packageName, model.originalFilePath);
  }

  getNodeFullPath(model: ManifestNode): string {
    if (model.packageName === 'dbt' && this.globalProjectPath) {
      return path.join(this.globalProjectPath, model.originalFilePath);
    }
    const inPackage = model.packageName !== this.projectName;

    return path.join(
      this.projectPath,
      inPackage ? this.packagesInstallPath : '',
      model.packageName === this.projectName ? '' : model.packageName,
      model.originalFilePath,
    );
  }

  getModelCompiledCode(model: ManifestModel): string | undefined {
    if (model.compiledCode) {
      return model.compiledCode;
    }

    const compiledPath = this.getModelCompiledPath(model);
    return DbtRepository.readFileIfExists(compiledPath);
  }

  private static readFileIfExists(filePath: string): string | undefined {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      console.log(`Cannot read ${filePath}`);
      return undefined;
    }
  }

  private groupManifestNodes(): void {
    this.groupManifestModelNodes();
    this.groupManifestMacroNodes();
    this.groupManifestSourceNodes();
  }

  private groupManifestModelNodes(): void {
    const newPackageToModels = new Map<string, Set<ManifestModel>>();

    for (const node of this.dag.nodes) {
      let packageModels = newPackageToModels.get(node.getValue().packageName);
      if (!packageModels) {
        packageModels = new Set();
        newPackageToModels.set(node.getValue().packageName, packageModels);
      }
      packageModels.add(node.getValue());
    }
    this.packageToModels = newPackageToModels;
  }

  private groupManifestMacroNodes(): void {
    const newPackageToMacros = new Map<string, Set<ManifestMacro>>();

    for (const macro of this.macros) {
      let packageMacros = newPackageToMacros.get(macro.packageName);
      if (!packageMacros) {
        packageMacros = new Set();
        newPackageToMacros.set(macro.packageName, packageMacros);
      }
      packageMacros.add(macro);
    }
    this.packageToMacros = newPackageToMacros;
  }

  private groupManifestSourceNodes(): void {
    const newPackageToSources = new Map<string, Map<string, Set<ManifestSource>>>();

    for (const source of this.sources) {
      let packageSources = newPackageToSources.get(source.packageName);
      if (!packageSources) {
        packageSources = new Map<string, Set<ManifestSource>>();
        newPackageToSources.set(source.packageName, packageSources);
      }

      let sourceTables = packageSources.get(source.sourceName);
      if (!sourceTables) {
        sourceTables = new Set();
        packageSources.set(source.sourceName, sourceTables);
      }
      sourceTables.add(source);
    }
    this.packageToSources = newPackageToSources;
  }
}
