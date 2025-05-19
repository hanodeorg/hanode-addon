import { exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import ignore from 'ignore';
import path from 'path';
import { parseCliArgs } from './cli';
import { ConfigProject, HanodeProjectConfigSchema, PackageManager, parseWithZod } from './config';

async function main() {
    let { srcDir, destDir } = parseCliArgs();
    const configPath = path.resolve(srcDir, 'hanode.config.json');
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    if (!fs.existsSync(srcDir)) {
        fs.mkdirSync(srcDir, { recursive: true });
    }
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    const configDir = path.dirname(configPath);
    const configFileContent = fs.readFileSync(configPath, { encoding: 'utf-8' });
    let configRaw;
    try {
        configRaw = JSON.parse(configFileContent);
    } catch (err) {
        throw new Error(`Error parsing config file: ${configPath}: ${err}`);
    }
    const { projects } = parseWithZod('Hanode project config', HanodeProjectConfigSchema, configRaw);
    if (projects.length === 0) {
        throw new Error(`No projects found in config file: ${configPath}`);
    }
    let mainProject: ConfigProject | null = null;
    for (const project of projects) {
        if (project.run_command && project.run_command !== undefined) {
            if (mainProject !== null) {
                throw new Error(`Multiple projects with runscript found in config file: ${configPath}`);
            } else {
                mainProject = project;
            }
        }
    }
    if (!mainProject) {
        throw new Error(`No project with runscript found in config file: ${configPath}`);
    }
    for (const project of projects) {
        const prj = new ProjectBundle(configDir, destDir, project);
        prj.copyFiles();
        await prj.installDependencies();
        await prj.build();
    }
    buildRunScriptContent(
        path.resolve(destDir, 'run-hanode-project.sh'),
        path.resolve(destDir, mainProject.path),
        mainProject.run_command!,
    );
}

class ProjectBundle {
    private srcProjectPath: string;
    private destProjectPath: string;
    private gitIgnorePath: string;

    constructor(configDir: string, destDir: string, private config: ConfigProject) {
        this.srcProjectPath = path.resolve(configDir, config.path);
        this.destProjectPath = path.resolve(destDir, config.path);
        this.gitIgnorePath = path.join(this.srcProjectPath, '.gitignore');
    }

    copyFiles() {
        const ig = ignore();
        if (fs.existsSync(this.gitIgnorePath)) {
            const gitIgnoreContent = fs.readFileSync(this.gitIgnorePath, { encoding: 'utf-8' });
            ig.add(gitIgnoreContent);
        }
        ig.add('node_modules'); // In case the user forgot
        ig.add('dependencies.hash'); // We certainly don't want to copy a file named like this, if it exists
        console.log(`Copying ${this.config.path}...`);
        copyDirectory(this.srcProjectPath, this.destProjectPath, ig, null);
    }

    async installDependencies(): Promise<void> {
        const changed = this.checkDependencies();
        if (!changed) {
            return;
        }
        console.log(`Dependencies changed for ${this.config.path}. Installing...`);

        const pkgManager: PackageManager = this.config.pkg ?? 'npm';
        const library: boolean = this.config.library ?? false;

        const packageJsonPath = path.join(this.destProjectPath, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`package.json not found in ${this.destProjectPath}`);
        }

        let command: string;
        switch (pkgManager) {
            case 'npm':
                if (library) {
                    command = 'npm install';
                } else {
                    const packageLockPath = path.join(this.destProjectPath, 'package-lock.json');
                    if (!fs.existsSync(packageLockPath)) {
                        throw new Error(`package-lock.json not found in ${this.destProjectPath}, required for clean install`);
                    }
                    command = 'npm ci';
                }
                break;
            case 'yarn':
                if (library) {
                    command = 'yarn install';
                } else {
                    const yarnLockPath = path.join(this.destProjectPath, 'yarn.lock');
                    if (!fs.existsSync(yarnLockPath)) {
                        throw new Error(`yarn.lock not found in ${this.destProjectPath}, required for clean install`);
                    }
                    command = 'yarn install --frozen-lockfile';
                }
                break;
            case 'pnpm':
                if (library) {
                    command = 'pnpm install';
                } else {
                    const pnpmLockPath = path.join(this.destProjectPath, 'pnpm-lock.yaml');
                    if (!fs.existsSync(pnpmLockPath)) {
                        throw new Error(`pnpm-lock.yaml not found in ${this.destProjectPath}, required for clean install`);
                    }
                    command = 'pnpm install --frozen-lockfile';
                }
                break;
            default:
                throw new Error(`Unsupported package manager: ${pkgManager}`);
        }

        console.log(`Installing dependencies with ${pkgManager} (${library ? 'standard' : 'clean'} install)...`);
        return await executeCommand(command, this.destProjectPath, 'installing dependencies');
    }

    async build(): Promise<void> {
        if (this.config.build_command) {
            console.log(`Building ${this.config.path}...`);
            await executeCommand(this.config.build_command, this.destProjectPath, 'building');
        }
    }

    private checkDependencies(): boolean {
        const packageJsonPath = path.join(this.destProjectPath, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`package.json not found in ${this.destProjectPath}`);
        }

        const depsMd5Path = path.join(this.destProjectPath, 'dependencies.hash');
        let currentHash: string | null = null;

        if (fs.existsSync(depsMd5Path)) {
            currentHash = fs.readFileSync(depsMd5Path, 'utf-8').trim();
        }

        let changed: boolean = false;
        const newHash = this.calculateDepsHash();

        if (currentHash !== newHash) {
            changed = true;
        }

        fs.writeFileSync(depsMd5Path, newHash);
        return changed;
    }

    private calculateDepsHash(): string {
        const hash = crypto.createHash('md5');

        for (let filename of ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
            const filePath = path.join(this.destProjectPath, filename);
            if (fs.existsSync(filePath)) {
                hash.update(fs.readFileSync(filePath, 'utf-8'));
            }
        }

        return hash.digest('hex');
    }
}

function copyDirectory(src: string, dest: string, ig: ignore.Ignore, parentPath: string | null) {
    if (!fs.existsSync(src)) {
        throw new Error(`Source directory does not exist: ${src}`);
    }
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const files = fs.readdirSync(src);
    for (const file of files) {
        const srcFilePath = path.join(src, file);
        if (ig.ignores(parentPath ? path.join(parentPath, file) : file)) {
            continue;
        }
        const destFilePath = path.join(dest, file);
        if (fs.statSync(srcFilePath).isDirectory()) {
            copyDirectory(srcFilePath, destFilePath, ig, parentPath ? path.join(parentPath, file) : file);
        }
        if (fs.statSync(srcFilePath).isFile()) {
            fs.copyFileSync(srcFilePath, destFilePath);
        }
    }
}

function buildRunScriptContent(runScriptPath: string, projectDir: string, runCommand: string) {
    const scriptContent = `#!/usr/bin/with-contenv bashio
        set -o pipefail
        export HOME_ASSISTANT_URL="$(bashio::config 'home_assistant_url')"
        export HOME_ASSISTANT_ACCESS_TOKEN="$(bashio::config 'home_assistant_access_token')"
        cd ${projectDir}
        exec ${runCommand}
    `
        .split('\n')
        .map((line) => line.trim())
        .join('\n');
    const runScriptDir = path.dirname(runScriptPath);
    if (!fs.existsSync(runScriptDir)) {
        fs.mkdirSync(runScriptDir, { recursive: true });
    }
    fs.writeFileSync(runScriptPath, scriptContent, { encoding: 'utf-8' });
    fs.chmodSync(runScriptPath, '755');
}

function executeCommand(command: string, cwd: string, context: string) {
    return new Promise<void>((resolve, reject) => {
        exec(command, { cwd }, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.error(`Error ${context}: ${error.message}`);
                reject(error);
                return;
            }
            console.log(stdout);
            if (stderr) {
                console.error(stderr);
            }
            resolve();
        });
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
