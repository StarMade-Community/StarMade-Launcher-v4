/**
 * Java runtime detection and management.
 *
 * StarMade version requirements:
 *   - Versions >= 0.3.x   require Java 25  (with --add-opens arg)
 *   - Versions <  0.3.x   require Java 8   (no extra args)
 *
 * Phase 4 TODO:
 *   - Auto-download Adoptium/Temurin Java 8 and Java 25 to launcher directory
 *   - Store in `jre8/` and `jre25/` subdirectories
 *   - Detect system-installed Java versions as fallback
 *   - Expose IPC: java:detect, java:list, java:download
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** JVM arguments required for Java 25 when launching StarMade >= 0.3.x */
export const JAVA_25_ARGS = ['--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED'];

/** Java 8 requires no additional JVM arguments. */
export const JAVA_8_ARGS: string[] = [];

// ─── Version detection ────────────────────────────────────────────────────────

/**
 * Determine which Java major version is required for a given StarMade version.
 * @returns 25 for versions >= 0.3.x, otherwise 8.
 */
export function getRequiredJavaVersion(starMadeVersion: string): 8 | 25 {
  // Parse version string (format: "0.203.175" or "0.302.101" or "1.0")
  const parts = starMadeVersion.split('.').map(p => parseInt(p, 10));
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    // Default to Java 8 for unparseable versions (legacy/archive)
    return 8;
  }

  const [major, minor] = parts;

  // StarMade 1.x and above require Java 25
  if (major >= 1) return 25;

  // StarMade uses a 3-component minor number: 0.3xx.yyy = "0.3.x" era.
  // Versions 0.300.x and above require Java 25.
  // Legacy versions (0.200.x – 0.205.x, etc.) use Java 8.
  if (major === 0 && minor >= 300) return 25;

  return 8;
}

/**
 * Get the required JVM arguments for a given Java version.
 */
export function getJvmArgsForJava(javaVersion: 8 | 25): string[] {
  return javaVersion === 25 ? JAVA_25_ARGS : JAVA_8_ARGS;
}

// ─── Java download & detection (Phase 4) ─────────────────────────────────────

import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { createGunzip } from 'zlib';

const execFileAsync = promisify(execFile);

/**
 * Build the Adoptium download URL for the specified Java version.
 */
function getAdoptiumUrl(version: 8 | 25): string {
  const platform = process.platform === 'win32' ? 'windows' 
                 : process.platform === 'darwin' ? 'mac' 
                 : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  
  return `https://api.adoptium.net/v3/binary/latest/${version}/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;
}

/**
 * Download a file from a URL to a target path.
 */
function downloadFile(url: string, targetPath: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath);
    
    https.get(url, (response) => {
      // Handle redirects (301 Moved Permanently, 302 Found, 303 See Other,
      //                    307 Temporary Redirect, 308 Permanent Redirect)
      const status = response.statusCode ?? 0;
      if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(targetPath);
          downloadFile(redirectUrl, targetPath, onProgress).then(resolve).catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }
      
      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let receivedBytes = 0;
      
      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (onProgress && totalBytes > 0) {
          onProgress((receivedBytes / totalBytes) * 100);
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(targetPath, () => {}); // Clean up on error
      reject(err);
    });
  });
}

/**
 * Extract a .tar.gz archive to a target directory.
 */
async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const gunzip = createGunzip();
    extract.on('entry', (header, stream, next) => {
      const filePath = path.join(targetDir, header.name);

      if (header.type === 'directory') {
        fs.mkdirSync(filePath, { recursive: true });
        stream.resume();
        stream.on('end', next);
        stream.on('error', reject);

      } else if (header.type === 'symlink' || header.type === 'link') {
        // JDK archives contain many symlinks; create them instead of writing data.
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          fs.symlinkSync(header.linkname!, filePath);
        } catch (err) {
          // Non-fatal: symlink target may not exist yet in the archive order.
          console.warn(`[Java] Warning: failed to create symlink ${filePath} -> ${header.linkname}:`, err);
        }
        stream.resume();
        stream.on('end', next);
        stream.on('error', reject);

      } else {
        // Regular file — wait for the WriteStream to *finish* before chmod/next
        // so the file is guaranteed to exist on disk.
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const writeStream = fs.createWriteStream(filePath);
        stream.pipe(writeStream);

        writeStream.on('finish', () => {
          if (header.mode && process.platform !== 'win32') {
            try {
              fs.chmodSync(filePath, header.mode);
            } catch (err) {
              console.warn(`[Java] Warning: failed to chmod ${filePath}:`, err);
            }
          }
          next();
        });

        writeStream.on('error', reject);
        stream.on('error', reject);
      }
    });

    extract.on('finish', resolve);
    extract.on('error', reject);
    gunzip.on('error', reject);

    fs.createReadStream(archivePath).pipe(gunzip).pipe(extract);
  });
}

/**
 * Download the specified Java runtime (Adoptium/Temurin) to the launcher's jre8/ or jre25/ directory.
 */
export async function downloadJava(
  version: 8 | 25, 
  launcherDir: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const jreDir = path.join(launcherDir, `jre${version}`);
  const tempFile = path.join(launcherDir, `jre${version}.tmp`);
  
  console.log(`[Java] Downloading Java ${version} from Adoptium...`);
  
  try {
    // Download the archive
    const url = getAdoptiumUrl(version);
    await downloadFile(url, tempFile, onProgress);
    
    console.log(`[Java] Download complete. Extracting to ${jreDir}...`);
    
    // Remove existing JRE directory if it exists
    if (fs.existsSync(jreDir)) {
      fs.rmSync(jreDir, { recursive: true, force: true });
    }
    
    // Create target directory
    fs.mkdirSync(jreDir, { recursive: true });
    
    // Extract based on platform
    if (process.platform === 'win32') {
      // Windows: .zip
      const zip = new AdmZip(tempFile);
      zip.extractAllTo(jreDir, true);
    } else {
      // macOS/Linux: .tar.gz
      await extractTarGz(tempFile, jreDir);
    }
    
    // Find the Java executable in the extracted files
    const javaPath = await findJavaExecutable(jreDir);
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    console.log(`[Java] Java ${version} installed successfully at ${javaPath}`);
    return javaPath;
    
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    if (fs.existsSync(jreDir)) fs.rmSync(jreDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Recursively find the java/javaw executable in a directory.
 * Throws if not found.
 */
function findJavaExecutable(dir: string): string {
  const javaExe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  
  function search(currentDir: string): string | null {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        const result = search(fullPath);
        if (result) return result;
      } else if (entry.name === javaExe) {
        return fullPath;
      }
    }
    
    return null;
  }
  
  const result = search(dir);
  if (!result) {
    throw new Error(`Could not find ${javaExe} in extracted JRE`);
  }
  
  return result;
}

/**
 * Recursively find the java/javaw executable in a JRE directory.
 * Unlike `findJavaExecutable`, returns null instead of throwing when
 * the executable is not found — safe for use in detection logic.
 *
 * Adoptium/Temurin archives are extracted with a versioned subdirectory
 * inside the target folder (e.g. jre8/jdk8u362-b09-jre/bin/java), so a
 * simple path.join(jreDir, 'bin', 'java') will always miss them.
 */
export function findJavaExecutableInDir(dir: string): string | null {
  try {
    return findJavaExecutable(dir);
  } catch {
    return null;
  }
}

/**
 * Parse Java version from `java -version` output.
 * Returns the major version number (e.g. 8, 11, 17, 25).
 */
export function parseJavaVersion(versionOutput: string): number | null {
  // Example outputs:
  // openjdk version "1.8.0_362"
  // openjdk version "11.0.18"
  // java version "17.0.6"
  // openjdk version "25.0.0"
  
  const match = versionOutput.match(/version "([^"]+)"/);
  if (!match) return null;
  
  const versionStr = match[1];
  const parts = versionStr.split('.');
  
  // Handle 1.8.x format (Java 8)
  if (parts[0] === '1' && parts[1]) {
    return parseInt(parts[1], 10);
  }
  
  // Handle 11.x, 17.x, 25.x format
  return parseInt(parts[0], 10);
}

/**
 * Check if a Java executable is valid and return its version.
 */
async function checkJavaExecutable(javaPath: string): Promise<{ version: number; path: string } | null> {
  try {
    const { stderr } = await execFileAsync(javaPath, ['-version']);
    const version = parseJavaVersion(stderr);
    
    if (version) {
      return { version, path: javaPath };
    }
  } catch (error) {
    // Executable doesn't exist or failed to run
  }
  
  return null;
}

/**
 * Detect system-installed Java runtimes by scanning common install paths.
 */
export async function detectSystemJava(): Promise<Array<{ version: string; path: string }>> {
  const results: Array<{ version: string; path: string }> = [];
  const javaExe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  
  // Common Java installation paths per platform
  let searchPaths: string[] = [];
  
  if (process.platform === 'win32') {
    searchPaths = [
      'C:\\Program Files\\Java',
      'C:\\Program Files (x86)\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Temurin',
    ];
    
    // Add JAVA_HOME if set
    if (process.env.JAVA_HOME) {
      searchPaths.push(process.env.JAVA_HOME);
    }
  } else if (process.platform === 'darwin') {
    searchPaths = [
      '/Library/Java/JavaVirtualMachines',
      '/System/Library/Java/JavaVirtualMachines',
    ];
    
    if (process.env.JAVA_HOME) {
      searchPaths.push(process.env.JAVA_HOME);
    }
  } else {
    // Linux
    searchPaths = [
      '/usr/lib/jvm',
      '/usr/java',
      '/opt/java',
      '/usr/lib64/jvm',
    ];
    
    if (process.env.JAVA_HOME) {
      searchPaths.push(process.env.JAVA_HOME);
    }
  }
  
  // Scan each path
  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue;
    
    try {
      const entries = fs.readdirSync(searchPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const baseDir = path.join(searchPath, entry.name);
        let javaPath: string;
        
        // Platform-specific path to bin/java
        if (process.platform === 'darwin') {
          javaPath = path.join(baseDir, 'Contents', 'Home', 'bin', javaExe);
        } else {
          javaPath = path.join(baseDir, 'bin', javaExe);
        }
        
        // Check if the executable exists and works
        const result = await checkJavaExecutable(javaPath);
        if (result) {
          results.push({ version: String(result.version), path: result.path });
        }
      }
    } catch (error) {
      // Skip directories we can't read
      continue;
    }
  }
  
  // Also check java in PATH
  try {
    const { stderr } = await execFileAsync('java', ['-version']);
    const version = parseJavaVersion(stderr);
    if (version) {
      const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['java']);
      const javaPath = stdout.trim().split('\n')[0];
      
      // Only add if not already in results
      if (!results.some(r => r.path === javaPath)) {
        results.push({ version: String(version), path: javaPath });
      }
    }
  } catch (error) {
    // Java not in PATH
  }
  
  return results;
}

/**
 * Resolve the Java executable path for the given required version.
 * Priority order:
 *   1. Launcher-bundled JRE (jre8/ or jre25/)
 *   2. System-installed Java matching the required version
 *   3. Returns null if not found (caller should trigger download)
 */
export async function resolveJavaPath(requiredVersion: 8 | 25, launcherDir: string): Promise<string | null> {
  // 1. Check bundled JRE.
  // Adoptium/Temurin archives extract into a versioned subdirectory inside
  // jreDir (e.g. jre8/jdk8u362-b09-jre/bin/java), so we must search
  // recursively rather than assuming jreDir/bin/java exists directly.
  const jreDir = path.join(launcherDir, `jre${requiredVersion}`);

  if (fs.existsSync(jreDir)) {
    const bundledJavaPath = findJavaExecutableInDir(jreDir);
    if (bundledJavaPath) {
      const result = await checkJavaExecutable(bundledJavaPath);
      if (result && result.version === requiredVersion) {
        console.log(`[Java] Using bundled Java ${requiredVersion}: ${bundledJavaPath}`);
        return bundledJavaPath;
      }
    }
  }
  
  // 2. Check system Java
  const systemJavas = await detectSystemJava();
  const matchingJava = systemJavas.find(j => parseInt(j.version, 10) === requiredVersion);
  
  if (matchingJava) {
    console.log(`[Java] Using system Java ${requiredVersion}: ${matchingJava.path}`);
    return matchingJava.path;
  }
  
  // 3. Not found
  console.log(`[Java] Java ${requiredVersion} not found`);
  return null;
}

/**
 * Get the default Java executable paths for jre8 and jre25 from the launcher directory.
 * These paths may not exist yet if the JREs haven't been downloaded.
 * @returns Object with jre8Path and jre25Path strings.
 */
export function getDefaultJavaPaths(launcherDir: string): { jre8Path: string; jre25Path: string } {
  const jre8Path = process.platform === 'win32'
    ? path.join(launcherDir, 'jre8', 'bin', 'javaw.exe')
    : path.join(launcherDir, 'jre8', 'bin', 'java');
  
  const jre25Path = process.platform === 'win32'
    ? path.join(launcherDir, 'jre25', 'bin', 'javaw.exe')
    : path.join(launcherDir, 'jre25', 'bin', 'java');
  
  return { jre8Path, jre25Path };
}

