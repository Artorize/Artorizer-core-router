import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import pino from 'pino';

const VERSION_FILE = join(process.cwd(), '.version-info.json');

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
  lastUpdated: string;
  previousCommit?: string;
}

export class SelfUpdateService {
  private logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger;
  }

  /**
   * Get current version information
   */
  getVersionInfo(): VersionInfo {
    try {
      const packageJson = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
      );

      const commit = this.getCurrentCommit();
      const branch = this.getCurrentBranch();

      // Try to read existing version info
      if (existsSync(VERSION_FILE)) {
        const existing = JSON.parse(readFileSync(VERSION_FILE, 'utf-8'));
        return {
          version: packageJson.version,
          commit,
          branch,
          lastUpdated: existing.lastUpdated,
          previousCommit: existing.commit !== commit ? existing.commit : existing.previousCommit,
        };
      }

      // First run - create version info
      return {
        version: packageJson.version,
        commit,
        branch,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to get version info');
      return {
        version: 'unknown',
        commit: 'unknown',
        branch: 'unknown',
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  /**
   * Save version information to file
   */
  private saveVersionInfo(info: VersionInfo): void {
    try {
      writeFileSync(VERSION_FILE, JSON.stringify(info, null, 2));
    } catch (error) {
      this.logger.warn({ error }, 'Failed to save version info');
    }
  }

  /**
   * Get current git commit hash
   */
  private getCurrentCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get current git branch
   */
  private getCurrentBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if updates are available
   */
  async checkForUpdates(): Promise<boolean> {
    try {
      this.logger.info('Checking for updates...');

      // Fetch latest changes
      execSync('git fetch origin', { encoding: 'utf-8', stdio: 'pipe' });

      const currentCommit = this.getCurrentCommit();
      const branch = this.getCurrentBranch();

      // Check if there are new commits
      const upstreamCommit = execSync(`git rev-parse origin/${branch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      const hasUpdates = currentCommit !== upstreamCommit;

      if (hasUpdates) {
        this.logger.info(
          { currentCommit, upstreamCommit, branch },
          'Updates available'
        );
      } else {
        this.logger.info('Already up to date');
      }

      return hasUpdates;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to check for updates');
      return false;
    }
  }

  /**
   * Perform self-update by pulling latest changes and rebuilding
   */
  async performUpdate(): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.info('Starting self-update process...');

      const currentInfo = this.getVersionInfo();
      const branch = this.getCurrentBranch();

      // Pull latest changes
      this.logger.info({ branch }, 'Pulling latest changes...');
      const pullOutput = execSync(`git pull origin ${branch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Check if anything was updated
      if (pullOutput.includes('Already up to date')) {
        this.logger.info('Already up to date');
        return { success: true, message: 'Already up to date' };
      }

      // Install dependencies
      this.logger.info('Installing dependencies...');
      execSync('npm install', { encoding: 'utf-8', stdio: 'pipe' });

      // Rebuild
      this.logger.info('Building application...');
      execSync('npm run build', { encoding: 'utf-8', stdio: 'pipe' });

      // Update version info
      const newInfo: VersionInfo = {
        ...this.getVersionInfo(),
        lastUpdated: new Date().toISOString(),
        previousCommit: currentInfo.commit,
      };
      this.saveVersionInfo(newInfo);

      this.logger.info(
        { from: currentInfo.commit.substring(0, 7), to: newInfo.commit.substring(0, 7) },
        'Self-update completed successfully'
      );

      return {
        success: true,
        message: `Updated from ${currentInfo.commit.substring(0, 7)} to ${newInfo.commit.substring(0, 7)}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error({ error }, 'Self-update failed');
      return { success: false, message: `Update failed: ${errorMessage}` };
    }
  }

  /**
   * Perform update check and update if available
   */
  async updateIfAvailable(): Promise<void> {
    try {
      const hasUpdates = await this.checkForUpdates();

      if (hasUpdates) {
        const result = await this.performUpdate();

        if (result.success) {
          this.logger.info(result.message);
        } else {
          this.logger.warn(result.message);
        }
      } else {
        // Save current version info even if no updates
        const info = this.getVersionInfo();
        this.saveVersionInfo(info);
      }
    } catch (error) {
      this.logger.warn({ error }, 'Update check failed, continuing with startup');
    }
  }

  /**
   * Display version information
   */
  displayVersion(): void {
    const info = this.getVersionInfo();

    console.log('\n=== Artorizer Core Router ===');
    console.log(`Version:      ${info.version}`);
    console.log(`Commit:       ${info.commit.substring(0, 7)}`);
    console.log(`Branch:       ${info.branch}`);
    console.log(`Last Updated: ${new Date(info.lastUpdated).toLocaleString()}`);

    if (info.previousCommit) {
      console.log(`Previous:     ${info.previousCommit.substring(0, 7)}`);
    }

    console.log('============================\n');
  }
}
